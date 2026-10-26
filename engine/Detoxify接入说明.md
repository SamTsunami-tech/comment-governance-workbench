# 可选 Detoxify 接入口

当前交付的是**预留适配器，未启动模型**。没有安装 Detoxify，没有下载权重，没有执行模型推理。网站默认仍使用 `comment-engine.js` 的规则演示；接入口不影响现有页面，也没有把示例分数冒充模型结果。

## 当前可以验证什么

`detoxify_adapter.py` 只依赖 Python 标准库就能启动未加载模型的接口壳。`GET /health` 返回 `modelLoaded: false`；向 `POST /predict` 发送合法正文时返回 503“模型未启动”。已编写无模型单元测试，测试替身仅检查输出协议，不是实际模型输出。

```sh
python3 engine/detoxify_adapter.py --port 8791 --allow-origin http://127.0.0.1:8768
```

服务固定绑定 `127.0.0.1`，没有公开网络绑定参数。这里的网页来源端口只是示例，应改成实际本地网站地址；`localhost` 和 `127.0.0.1` 是不同来源，需要分别加入白名单。默认白名单为空。`file://` 页面的 `Origin: null` 被拒绝，需先通过本地 HTTP 预览网站。公开网页到本机服务的调用还受浏览器的本地网络权限约束，不能保证任意浏览器直接可用。

## 后续真正启用时

需先在自己的环境中准备兼容的 Detoxify/PyTorch/Transformers 依赖、可信的 Detoxify checkpoint，以及配套的本地 Hugging Face 配置和 tokenizer 资源。适配器不会替你安装或下载这些文件，也不接受请求正文指定模型路径。

```sh
python3 engine/detoxify_adapter.py \
  --port 8791 \
  --allow-origin http://127.0.0.1:8768 \
  --enable-model \
  --model-type multilingual \
  --checkpoint /可信的本地路径/model.ckpt \
  --hf-config-dir /本地路径/config_and_tokenizer
```

只有显式加上 `--enable-model` 且提供两类本地资源时才尝试导入并加载。加载前开启 Hugging Face 离线模式；缺文件或版本不兼容时失败退出，不转为在线下载。checkpoint 由上游通过 PyTorch 加载，只能使用可信来源的权重。本项目没有实测该加载分支，因此不声称已完成模型兼容性验证。

接入参数依据 [Detoxify 官方代码](https://github.com/unitaryai/detoxify/blob/master/detoxify/detoxify.py) 的本地 `checkpoint`、`huggingface_config_path` 和 `predict` 接口整理。上游会在预测时截断长文本；本适配器先检查 tokenizer 长度，超过可用上限则返回 422，避免默默丢失后半段。模型版本变动后还需实际回归验证。

## 请求与返回

`POST /predict` 只接受 UTF-8 `application/json`：

```json
{"text":"需要检测的原文评论"}
```

请求最多 16384 字节，文本最多 2000 个字符；空白、非字符串、额外字段、重复 JSON 字段、无效 Unicode 和分词后超限均拒绝。不支持批量、分块上传和文件上传。HTTP 层要求单个有效 `Content-Length`，读取超时为 5 秒。

真正加载模型后，输出协议为：

```json
{
  "scores": {"toxicity": 0.0, "insult": 0.0},
  "modelVersion": {
    "adapter": "commentops-detoxify-adapter/1.0.0",
    "detoxify": "实际安装版本",
    "modelType": "multilingual",
    "checkpointSha256": "实际权重摘要",
    "device": "cpu"
  },
  "scoreMeaning": "模型原始毒性维度分数，未校准为本项目风控概率",
  "riskMapping": null,
  "action": null
}
```

上面的零值仅为协议示意，未发生推理。实际返回保留模型给出的原始维度；不同模型维度可能不同。`toxicity`、`insult`、`identity_attack` 等维度不能无条件对应诈骗、隐私、色情等业务风险，更不能直接生成拦截动作。后续必须用独立人工标注数据验证语言切片、语境误伤和阈值，才可设计业务映射；此交付没有做这一层映射。

## 来源约束与异常

浏览器请求必须携带精确匹配白名单的 `Origin`；不允许 `*`、`null`、含路径的来源或任意网站。仅对匹配来源响应跨域许可，不发送凭据许可。无 `Origin` 的本机工具调用需加 `X-CommentOps-Local: 1`；这只是本地请求约束，不是账户认证。Host 也限制为本地服务地址，减少意外域名转发。

错误返回 `{"error":{"code":"中文错误类型","message":"中文说明"}}`。常见状态为 400 格式错误、403 来源拒绝、413 大小超限、415 内容类型错误、422 文本或 token 超限、503 模型未启动或推理失败。内部错误堆栈和评论正文不写入请求日志。服务不存评论、不修改网站金标、不包含上传发布功能，不具备生产环境的身份权限、限流、持久化或运维能力。

## 验证方式

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s engine -p 'test_detoxify_adapter.py' -v
```

测试不监听端口、不导入模型，覆盖正文类型与大小、编码、重复字段、跨域来源、未启动状态、原始分数协议、异常处理及缺失本地资源。页面仍应显示“规则分”，不能把接入准备工作写成已部署模型。
