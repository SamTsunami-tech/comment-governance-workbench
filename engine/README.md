# 评论风控规则与离线评估核心

这是作品集网站的可运行规则模块，不调用机器学习模型，也不代表任何平台的真实政策或线上效果。六种外语通过明确列出的词组及语境规则处理；可检验规则行为，不据此推断开放场景的泛化能力。

浏览器直接加载 `comment-engine.js`，使用 `window.CommentEngine`；Node 使用 `require('./comment-engine.js')`。无第三方依赖，原文和中文释义都保留，页面展示 `text`、`reason`、`evidence` 时必须使用文本节点或 `textContent`，不能作为 HTML 插入。

## 输入与预测

`evaluate(sample, config)` 返回 `{score, action, risk, reason, ruleHits, evidence, contextNotes, engineType}`。规则分为 0—100 的演示处置分，不是概率。最高命中规则决定主风险；一条评论可保留多条规则证据。命中记录含规则编号、风险、原始分、语境调整后的分、片段及片段来源。没有命中不等于安全，只表示当前规则未发现风险。

样本字段：`id`、`text`、`translation`、`language`、`market`、`context`、`contextType`、`goldRisk`、`goldAction`、`split`、`week`。预测仅读取正文、释义及语境字段，绝不以 `risk`、`goldRisk`、`goldAction` 作为特征。`goldAction: null` 表示尚未裁决。

`contextType` 使用 `direct`、`quoted_condemnation`、`self_reference`、`banter`、`missing`、`neutral`。这些是演示资料中的可见语境信息，真实业务需要上文和人工验证，不能把金标改名后送入规则。引用并反对攻击会降级；自我陈述与定向攻击分开；玩笑中的侮辱进入复核；缺少关键语境的片段不会强行判为明确违规。降低分值不擦除原命中证据。

风险包括正常、辱骂骚扰、身份攻击、暴力威胁、色情低俗、诈骗引流、隐私暴露、语境待核。动作包括放行、人工复核、拦截。默认参数：

```js
const config = {
  reviewThreshold: 35,
  blockThreshold: 75,
  contextProtection: true,
  strictPrivacy: true
};
const result = CommentEngine.evaluate(sample, config);
```

分值达到拦截阈值则拦截，否则达到复核阈值则复核。无命中且有完整语境的记录放行；空白记录不因零阈值被拦。阈值必须为有限数值且满足 `0 ≤ reviewThreshold ≤ blockThreshold ≤ 100`，不符合时抛出错误。`strictPrivacy` 只调整联系方式加曝光语境的规则，不将任意数字视为隐私。

## 指标、切片和分母

`runEvaluation(samples, config, {split})` 可指定 `策略集` 或 `留出集`。结果包含 `total`、`labeled`、`riskLabeled`、`uncertain`、`metrics`、`counts`、`numerators`、`denominators`、`confusion`、`predictions`、`slices`、`duplicateIds`。

**所有指标为 0—1 的比例；页面乘以 100 后显示百分比。分母为零时返回 `null`，页面应显示“暂无适用样本”，不能显示 0% 或 100%。**

| 指标字段 | 分子 | 分母 |
| --- | --- | --- |
| `recall` 风险召回率 | 已确定风险样本中，预测为人工复核或拦截的数量 | 同时具有有效动作金标及明确非正常风险金标的样本数 |
| `blockPrecision` 拦截精度 | 预测拦截且明确风险金标非正常的数量 | 预测拦截且具有有效动作与明确风险金标的样本数 |
| `falseBlockRate` 正常误拦率 | 明确正常金标中预测拦截的数量 | 同时具有有效动作金标及正常风险金标的样本数 |
| `reviewRate` 人工复核率 | 预测人工复核的数量 | 评估记录数，包含未决样本 |
| `actionAccuracy` 动作准确率 | 预测动作等于动作金标的数量 | 有效动作金标样本数，无需风险金标 |
| `blockRate` 拦截率 | 预测拦截的数量 | 评估记录数，包含未决样本 |

`labeled` 仅统计三个合法动作金标。未决、缺失和无效动作不进入确定标签的质量指标。`riskLabeled` 还要求明确风险金标且不是语境待核；缺失风险金标的记录只可计动作准确率、工作量指标，不能算风险召回。`uncertain` 是没有有效动作金标的记录数，并非所有语境待核类别数。

非空 `id` 重复时只保留首次记录并返回重复编号，避免重复提交使样本权重增加。无编号记录各自保留，使用输入位置编号。`confusion.action` 的行是人工动作金标、列是预测动作；`confusion.risk` 的行是明确风险金标、列是预测主风险。风险召回衡量进入治理链路，不是风险类型分类准确率。

`slices` 对语言、市场、风险、周、数据划分分别切片。各切片独立给出同样的分子、分母与混淆矩阵，避免把不同规模的语言简单平均。风险切片可采用金标或样本风险字段描述，分类字段不参与预测。不得把这些离线指标叫作真实转化率、线上拦截率或线上成本下降。

## 候选策略冻结

```js
const draft = CommentEngine.strategyCompare(samples, baselineConfig, candidateConfig);
// draft.dev 有结果；draft.holdout 为 null。
const frozen = CommentEngine.freezeStrategy(candidateConfig);
const report = CommentEngine.strategyCompare(samples, baselineConfig, frozen);
// report.dev 与 report.holdout 分开；各有 baseline、candidate、delta 和 changed。
```

冻结创建不可变参数快照及稳定参数指纹，避免后续滑块修改追溯改变已冻结策略。留出集只有传入合法冻结快照时才计算；不提供留出集反馈来实时调参。这个浏览器交互约束不是保密或防作弊系统，调用者直接传入所有数据仍可自行读取，真正独立评估应把留出标签隔离到受控环境。

## 处置记录与重复请求

`applyDisposition(state, event)` 接收 `{eventId, sampleId, action, strategyId}`，返回 `{status, applied, state, event}`。新事件创建新状态、不修改旧状态；相同事件编号与相同内容重试只返回原记录，不重复追加；编号相同但内容不同会报错。不同事件编号可表示后续人工复判，`latest` 保留最新动作。这是本地流程演示，不替代服务器权限控制、审计留存或分布式幂等实现。

## 验证

在项目根目录运行 `node --test tests/engine.test.cjs`。测试覆盖阈值、六种语言规则、语境对照、隐私参数、金标不泄漏到预测、独立分母、空分母、重复编号、候选冻结、HTML 类文本输入与重复处置。

## 可选模型适配器

`detoxify_adapter.py` 预留了仅绑定本机的 Detoxify HTTP 接口。当前没有加载或运行模型，网站保持规则模式。启用条件、离线资源要求、请求约束和无模型测试见 [Detoxify接入说明.md](./Detoxify接入说明.md)。原始毒性维度不自动等同于业务风险或处置动作。
