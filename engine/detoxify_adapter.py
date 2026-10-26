#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地 Detoxify 预留适配器。默认不导入模型、不下载模型、不执行推理。"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import socket
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit

ADAPTER_VERSION = "commentops-detoxify-adapter/1.0.0"
MAX_BODY_BYTES = 16 * 1024
MAX_TEXT_CHARS = 2000
READ_TIMEOUT_SECONDS = 5
MODEL_TYPES = ("original", "unbiased", "multilingual")


class APIError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def valid_origin(value):
    """只接受精确的 http(s) 来源，禁止通配符、null 和路径。"""
    if not isinstance(value, str) or any(char.isspace() or ord(char) < 32 for char in value):
        return False
    try:
        parts = urlsplit(value)
        _ = parts.port
        return (parts.scheme in ("http", "https") and bool(parts.hostname)
                and parts.username is None and parts.password is None
                and not parts.path and not parts.query and not parts.fragment
                and value != "null" and "*" not in value)
    except (ValueError, TypeError):
        return False


def parse_text(body, content_type):
    if not isinstance(body, bytes):
        raise APIError(400, "请求格式错误", "请求正文必须是 UTF-8 JSON")
    if not body or len(body) > MAX_BODY_BYTES:
        raise APIError(413, "请求大小不符", "请求正文需为 1—16384 字节")
    parts = str(content_type).lower().split(";")
    if parts[0].strip() != "application/json":
        raise APIError(415, "内容类型不支持", "请使用 application/json")
    if any(p.strip() not in ("charset=utf-8", "charset=\"utf-8\"") for p in parts[1:]):
        raise APIError(415, "字符集不支持", "JSON 仅支持 UTF-8")

    def no_duplicates(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("重复字段")
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError("不支持的 JSON 常量")

    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=no_duplicates,
                           parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise APIError(400, "JSON 无效", "请求需为有效 UTF-8 JSON，不能有重复字段")
    if not isinstance(value, dict) or set(value) != {"text"} or not isinstance(value["text"], str):
        raise APIError(422, "文本字段不符", "正文只接受一个字符串字段 text")
    text = value["text"]
    try:
        text.encode("utf-8", "strict")
    except UnicodeError:
        raise APIError(422, "文本编码无效", "文本包含无效 Unicode 字符")
    if not text.strip():
        raise APIError(422, "文本为空", "请输入需要检测的评论")
    if len(text) > MAX_TEXT_CHARS:
        raise APIError(422, "文本过长", "单条评论最多 2000 个字符，不进行静默截断")
    return text


def normalized_scores(raw):
    if not isinstance(raw, dict) or not raw:
        raise APIError(502, "模型输出无效", "模型没有返回有效的毒性维度")
    result = {}
    for name, value in raw.items():
        if not isinstance(name, str) or not name or len(name) > 64:
            raise APIError(502, "模型输出无效", "模型维度名称无效")
        if isinstance(value, (str, bytes, bool)):
            raise APIError(502, "模型输出无效", "模型分数必须是有限的数值")
        try:
            score = float(value)
        except (ValueError, TypeError, OverflowError):
            raise APIError(502, "模型输出无效", "模型分数必须是有限的数值")
        if not math.isfinite(score) or not 0 <= score <= 1:
            raise APIError(502, "模型输出无效", "模型分数必须位于 0—1")
        result[name] = score
    return result


class LocalDetoxifyPredictor:
    """仅由显式命令行参数启用；要求现成的可信权重和离线 HF 资源。"""
    def __init__(self, checkpoint, hf_config_dir, model_type="multilingual"):
        checkpoint = Path(checkpoint).expanduser().resolve()
        config_dir = Path(hf_config_dir).expanduser().resolve()
        if model_type not in MODEL_TYPES:
            raise ValueError("不支持的 Detoxify 模型类型")
        if not checkpoint.is_file() or not config_dir.is_dir() or not (config_dir / "config.json").is_file():
            raise ValueError("必须提供已存在的权重文件和含 config.json 的本地 HF 目录")
        # 在导入 transformers / detoxify 前设置。缺少本地资源时直接失败，不转为联网。
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_DATASETS_OFFLINE"] = "1"
        from detoxify import Detoxify  # 可选依赖，默认模式不导入
        self.model = Detoxify(model_type=model_type, checkpoint=str(checkpoint),
                              device="cpu", huggingface_config_path=str(config_dir))
        digest = hashlib.sha256()
        with checkpoint.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        self.model_version = {
            "adapter": ADAPTER_VERSION,
            "detoxify": importlib.metadata.version("detoxify"),
            "modelType": model_type,
            "checkpointSha256": digest.hexdigest(),
            "device": "cpu",
        }

    def predict(self, text):
        # Detoxify 自带 predict 会截断，先检查 token 上限，超限则拒绝。
        tokenizer = self.model.tokenizer
        ids = tokenizer.encode(text, add_special_tokens=True, truncation=False)
        configured = getattr(tokenizer, "model_max_length", 512)
        model_limit = getattr(self.model.model.config, "max_position_embeddings", 512)
        limits = [int(v) for v in (configured, model_limit, 512) if isinstance(v, (int, float)) and 0 < v <= 100000]
        limit = min(limits) if limits else 512
        if len(ids) > limit:
            raise APIError(422, "分词长度超限", "评论超过当前模型的分词上限，请缩短后提交；未进行推理")
        return self.model.predict(text)


class AdapterApp:
    def __init__(self, allowed_origins=(), predictor=None):
        if any(not valid_origin(origin) for origin in allowed_origins):
            raise ValueError("来源白名单必须是无路径的精确 http(s) 来源")
        self.allowed_origins = frozenset(allowed_origins)
        self.predictor = predictor

    def check_origin(self, headers, allow_local_client=False):
        origin = headers.get("Origin")
        if origin is not None:
            if origin not in self.allowed_origins:
                raise APIError(403, "来源不允许", "该网页来源未加入本地适配器白名单")
            return origin
        if allow_local_client and headers.get("X-CommentOps-Local") != "1":
            raise APIError(403, "缺少本地调用标记", "无 Origin 的本地调用需附带 X-CommentOps-Local: 1")
        return None

    def handle(self, method, path, headers, body=b""):
        origin = self.check_origin(headers, allow_local_client=(method == "POST"))
        cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else {}
        if method == "OPTIONS":
            if not origin or path != "/predict":
                raise APIError(403, "预检不允许", "请使用已列入白名单的网页来源")
            if headers.get("Access-Control-Request-Method") != "POST":
                raise APIError(405, "方法不支持", "推理端点仅支持 POST")
            requested = {p.strip().lower() for p in headers.get("Access-Control-Request-Headers", "").split(",") if p.strip()}
            if not requested.issubset({"content-type", "x-commentops-local"}):
                raise APIError(403, "请求头不允许", "预检含未允许的请求头")
            cors.update({"Access-Control-Allow-Methods": "POST, OPTIONS",
                         "Access-Control-Allow-Headers": "Content-Type, X-CommentOps-Local",
                         "Access-Control-Max-Age": "60"})
            # 仅对已显式允许的来源回答本地网络预检；浏览器仍可另外要求授权。
            if headers.get("Access-Control-Request-Private-Network") == "true":
                cors["Access-Control-Allow-Private-Network"] = "true"
            return 204, {}, cors
        if method == "GET" and path == "/health":
            return 200, {"status": "模型已加载" if self.predictor else "预留适配器，未启动模型",
                         "modelLoaded": self.predictor is not None,
                         "modelVersion": getattr(self.predictor, "model_version", None),
                         "adapterVersion": ADAPTER_VERSION}, cors
        if path != "/predict":
            raise APIError(404, "端点不存在", "仅提供 /health 和 /predict")
        if method != "POST":
            raise APIError(405, "方法不支持", "推理端点仅支持 POST")
        text = parse_text(body, headers.get("Content-Type", ""))
        if self.predictor is None:
            raise APIError(503, "模型未启动", "当前仅预留接入口，没有加载模型或执行推理")
        try:
            scores = normalized_scores(self.predictor.predict(text))
        except APIError:
            raise
        except Exception:
            raise APIError(503, "推理失败", "本地模型未完成推理；规则演示结果不因此改变")
        return 200, {"scores": scores, "modelVersion": self.predictor.model_version,
                     "scoreMeaning": "模型原始毒性维度分数，未校准为本项目风控概率",
                     "riskMapping": None, "action": None}, cors


def make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "CommentOpsLocalAdapter/1.0"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(READ_TIMEOUT_SECONDS)

        def log_message(self, fmt, *args):
            # 不记录评论正文、查询参数或原始请求行。
            return

        def dispatch(self):
            response_headers = {}
            try:
                hosts = self.headers.get_all("Host", [])
                expected = {"127.0.0.1:%d" % self.server.server_port,
                            "localhost:%d" % self.server.server_port}
                if len(hosts) != 1 or hosts[0] not in expected:
                    raise APIError(421, "主机名不允许", "请使用 127.0.0.1 的本地适配器地址")
                app.check_origin(self.headers, allow_local_client=(self.command == "POST"))
                origin = self.headers.get("Origin")
                if origin in app.allowed_origins:
                    response_headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
                body = b""
                if self.command == "POST":
                    if self.headers.get("Transfer-Encoding"):
                        raise APIError(501, "传输方式不支持", "不支持分块请求，请提供 Content-Length")
                    lengths = self.headers.get_all("Content-Length", [])
                    if not lengths:
                        raise APIError(411, "缺少正文长度", "请求必须包含 Content-Length")
                    if len(lengths) != 1 or not lengths[0].isdigit():
                        raise APIError(400, "正文长度无效", "Content-Length 必须是单个正整数")
                    length = int(lengths[0])
                    if not 0 < length <= MAX_BODY_BYTES:
                        raise APIError(413, "请求过大", "请求正文最多 16384 字节")
                    body = self.rfile.read(length)
                    if len(body) != length:
                        raise APIError(400, "正文未完成", "实际正文长度与 Content-Length 不符")
                status, payload, cors = app.handle(self.command, self.path, self.headers, body)
                response_headers.update(cors)
            except APIError as exc:
                status, payload = exc.status, {"error": {"code": exc.code, "message": exc.message}}
            except (TimeoutError, socket.timeout):
                status, payload = 408, {"error": {"code": "读取超时", "message": "请求未在 5 秒内完成"}}
            except Exception:
                status, payload = 500, {"error": {"code": "适配器异常", "message": "本地服务未完成请求"}}
            data = b"" if status == 204 else json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
            self.send_response(status)
            for key, value in response_headers.items():
                self.send_header(key, value)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            if data:
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass
            self.close_connection = True

        do_GET = dispatch
        do_POST = dispatch
        do_OPTIONS = dispatch
        do_PUT = dispatch
        do_DELETE = dispatch
        do_PATCH = dispatch
    return Handler


def main(argv=None):
    parser = argparse.ArgumentParser(description="评论治理作品集的本地 Detoxify 预留适配器")
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--allow-origin", action="append", default=[])
    parser.add_argument("--enable-model", action="store_true", help="显式启用本地模型；必须已有离线资源")
    parser.add_argument("--checkpoint", help="可信的本地 Detoxify 权重文件")
    parser.add_argument("--hf-config-dir", help="本地配置及 tokenizer 资源目录")
    parser.add_argument("--model-type", choices=MODEL_TYPES, default="multilingual")
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("端口需在 1024—65535 之间")
    if args.enable_model and (not args.checkpoint or not args.hf_config_dir):
        parser.error("启用模型必须同时提供 --checkpoint 和 --hf-config-dir")
    if not args.enable_model and (args.checkpoint or args.hf_config_dir):
        parser.error("提供模型路径时还需显式传入 --enable-model")
    try:
        predictor = LocalDetoxifyPredictor(args.checkpoint, args.hf_config_dir, args.model_type) if args.enable_model else None
        app = AdapterApp(args.allow_origin, predictor)
        server = HTTPServer(("127.0.0.1", args.port), make_handler(app))
    except Exception as exc:
        print("适配器未启动：%s" % type(exc).__name__, file=sys.stderr)
        return 2
    print("本地适配器：http://127.0.0.1:%d；%s" % (args.port, "模型已加载" if predictor else "预留适配器，未启动模型"))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
