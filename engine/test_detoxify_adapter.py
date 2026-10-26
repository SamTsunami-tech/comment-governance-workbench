# -*- coding: utf-8 -*-
"""无模型单元测试：不导入 Detoxify、不下载文件、不启动 HTTP 监听。"""
import json
import unittest
from detoxify_adapter import AdapterApp, APIError, LocalDetoxifyPredictor, MAX_BODY_BYTES, normalized_scores, parse_text, valid_origin


class FakePredictor:
    model_version = {"adapter": "测试替身", "detoxify": "未加载"}

    def predict(self, text):
        return {"toxicity": 0.25, "insult": 0.1}


class AdapterTests(unittest.TestCase):
    def assert_api_error(self, status, callback):
        with self.assertRaises(APIError) as context:
            callback()
        self.assertEqual(status, context.exception.status)

    def test_valid_text_and_html_remain_text(self):
        text = '<img src=x onerror="alert(1)">评论'
        self.assertEqual(text, parse_text(json.dumps({"text": text}).encode(), "application/json; charset=utf-8"))

    def test_payload_limits_types_duplicates_and_encoding(self):
        for payload in ({"text": 3}, {"text": None}, {"text": []}, [], {"text": " "}, {"text": "x", "goldAction": "放行"}):
            self.assert_api_error(422, lambda p=payload: parse_text(json.dumps(p).encode(), "application/json"))
        self.assert_api_error(413, lambda: parse_text(b"x" * (MAX_BODY_BYTES + 1), "application/json"))
        self.assert_api_error(422, lambda: parse_text(json.dumps({"text": "x" * 2001}).encode(), "application/json"))
        self.assert_api_error(400, lambda: parse_text(b'{"text":"a","text":"b"}', "application/json"))
        self.assert_api_error(400, lambda: parse_text(b'{"text":NaN}', "application/json"))
        self.assert_api_error(400, lambda: parse_text(b'\xff', "application/json"))
        self.assert_api_error(422, lambda: parse_text(b'{"text":"\\ud800"}', "application/json"))
        self.assert_api_error(415, lambda: parse_text(b'{"text":"a"}', "text/plain"))

    def test_origin_is_exact_and_no_file_or_wildcard(self):
        self.assertTrue(valid_origin("http://127.0.0.1:8768"))
        self.assertTrue(valid_origin("https://example.github.io"))
        for bad in ("*", "null", "file://", "http://localhost:8768/", "https://example.com/path", "https://user:pw@example.com", "https://example.com\n", None, 42):
            self.assertFalse(valid_origin(bad))
        app = AdapterApp(["http://127.0.0.1:8768"])
        self.assert_api_error(403, lambda: app.handle("POST", "/predict", {"Origin": "http://127.0.0.1:8769"}, b'{}'))
        self.assert_api_error(403, lambda: app.handle("POST", "/predict", {}, b'{}'))

    def test_default_reports_no_model_and_predict_returns_503(self):
        app = AdapterApp()
        status, health, _ = app.handle("GET", "/health", {})
        self.assertEqual(200, status)
        self.assertFalse(health["modelLoaded"])
        self.assertIsNone(health["modelVersion"])
        self.assert_api_error(503, lambda: app.handle("POST", "/predict", {"X-CommentOps-Local": "1", "Content-Type": "application/json"}, b'{"text":"hello"}'))

    def test_scores_preserve_original_dimensions_without_action_mapping(self):
        app = AdapterApp(["http://127.0.0.1:8768"], FakePredictor())
        status, data, cors = app.handle("POST", "/predict", {"Origin": "http://127.0.0.1:8768", "Content-Type": "application/json"}, b'{"text":"hello"}')
        self.assertEqual(200, status)
        self.assertEqual({"toxicity": 0.25, "insult": 0.1}, data["scores"])
        self.assertIsNone(data["action"])
        self.assertIsNone(data["riskMapping"])
        self.assertEqual("测试替身", data["modelVersion"]["adapter"])
        self.assertEqual("http://127.0.0.1:8768", cors["Access-Control-Allow-Origin"])
        for raw in ({"toxicity": float("nan")}, {"toxicity": 2}, {"toxicity": "0.3"}, {}):
            self.assert_api_error(502, lambda r=raw: normalized_scores(r))

    def test_preflight_and_exception_paths(self):
        app = AdapterApp(["http://127.0.0.1:8768"])
        headers = {"Origin": "http://127.0.0.1:8768", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}
        self.assertEqual(204, app.handle("OPTIONS", "/predict", headers)[0])
        self.assert_api_error(403, lambda: app.handle("OPTIONS", "/predict", dict(headers, **{"Access-Control-Request-Headers": "authorization"})))
        self.assert_api_error(405, lambda: app.handle("GET", "/predict", {}))
        self.assert_api_error(404, lambda: app.handle("GET", "/other", {}))
        class Broken(FakePredictor):
            def predict(self, text):
                raise RuntimeError("不应泄漏给调用者的内部信息")
        app = AdapterApp([], Broken())
        self.assert_api_error(503, lambda: app.handle("POST", "/predict", {"X-CommentOps-Local": "1", "Content-Type": "application/json"}, b'{"text":"hello"}'))

    def test_missing_local_model_resources_fail_before_optional_import(self):
        with self.assertRaises(ValueError):
            LocalDetoxifyPredictor("/不存在的权重.ckpt", "/不存在的目录")


if __name__ == "__main__":
    unittest.main(verbosity=2)
