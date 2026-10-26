/* 使用 Node 内置测试器；不需要安装依赖。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Engine = require('../engine/comment-engine.js');
const sample = (id, text, goldRisk, goldAction, extra = {}) => ({ id, text, goldRisk, goldAction, language: '英语', split: '策略集', ...extra });

test('阈值边界、非法阈值与空正文', () => {
  const s = sample('1', 'You are an idiot.', '辱骂骚扰', '人工复核');
  assert.equal(Engine.evaluate(s, { reviewThreshold: 62, blockThreshold: 75 }).action, '人工复核');
  assert.equal(Engine.evaluate(s, { reviewThreshold: 35, blockThreshold: 62 }).action, '拦截');
  assert.equal(Engine.evaluate({ text: '' }, { reviewThreshold: 0, blockThreshold: 0 }).action, '放行');
  assert.throws(() => Engine.evaluate(s, { reviewThreshold: 90, blockThreshold: 20 }), RangeError);
  assert.throws(() => Engine.evaluate(s, { blockThreshold: '不是数字' }), RangeError);
});

test('英语、西语、葡语、印尼语、法语、阿语均有可解释规则命中', () => {
  ["I'll kill you.", 'Te voy a matar.', 'Vou te matar.', 'Aku akan bunuh kamu.', 'Je vais te tuer.', 'سأقتلك'].forEach(text => {
    const r = Engine.evaluate({ text, contextType: 'direct' });
    assert.equal(r.action, '拦截', text);
    assert.equal(r.risk, '暴力威胁', text);
    assert.ok(r.ruleHits.some(hit => hit.id === 'T01'));
  });
  assert.equal(Engine.evaluate({ text: 'Send me nude photos.' }).risk, '色情低俗');
});

test('引用反对、自我陈述、朋友玩笑和缺失语境分开处置', () => {
  const quoted = { text: 'He wrote “I will kill you”. I condemn it.', contextType: 'quoted_condemnation' };
  assert.equal(Engine.evaluate(quoted).action, '放行');
  assert.equal(Engine.evaluate(quoted, { contextProtection: false }).action, '拦截');
  assert.equal(Engine.evaluate({ text: 'I called myself an idiot.', contextType: 'self_reference' }).action, '放行');
  assert.equal(Engine.evaluate({ text: 'You are an idiot.', contextType: 'banter' }).action, '人工复核');
  assert.equal(Engine.evaluate({ text: 'You know what comes next.', contextType: 'missing' }).risk, '语境待核');
});

test('隐私严格模式只改变相应规则，预测不读取金标', () => {
  const s = { text: 'Her phone number is +1 202-555-0148.', contextType: 'direct' };
  assert.equal(Engine.evaluate(s).action, '拦截');
  assert.equal(Engine.evaluate(s, { strictPrivacy: false }).action, '人工复核');
  const a = Engine.evaluate({ ...s, risk: '正常', goldRisk: '正常', goldAction: '放行' });
  const b = Engine.evaluate({ ...s, risk: '暴力威胁', goldRisk: '暴力威胁', goldAction: '拦截' });
  assert.deepEqual(a, b);
  assert.equal(Engine.evaluate({ text: 'Su teléfono es 202-555-0148.' }).risk, '隐私暴露');
});

test('分母按指标独立计算，未决与重复编号不稀释确定标签质量', () => {
  const rows = [
    sample('1', 'I will kill you.', '暴力威胁', '拦截', { week: '第1周' }),
    sample('2', 'You are an idiot.', '辱骂骚扰', '人工复核', { week: '第2周' }),
    sample('3', 'Thanks!', '正常', '放行'),
    sample('4', 'I will kill you.', '正常', '放行'),
    sample('5', 'You are an idiot.', '语境待核', null),
    sample('6', 'Thanks!', undefined, '放行'),
    sample('1', 'Thanks!', '正常', '放行')
  ];
  const r = Engine.runEvaluation(rows);
  assert.equal(r.total, 6);
  assert.equal(r.labeled, 5);
  assert.equal(r.riskLabeled, 4);
  assert.deepEqual(r.duplicateIds, ['1']);
  assert.equal(r.metrics.recall, 1);
  assert.equal(r.metrics.blockPrecision, 1 / 2);
  assert.equal(r.metrics.falseBlockRate, 1 / 2);
  assert.equal(r.metrics.reviewRate, 2 / 6);
  assert.equal(r.metrics.actionAccuracy, 4 / 5);
  assert.equal(r.denominators.recall, 2);
  assert.equal(r.denominators.reviewRate, 6);
  assert.equal(r.confusion.action['放行']['拦截'], 1);
  assert.equal(r.slices.week.reduce((n, s) => n + s.total, 0), 6);
  assert.equal(r.slices.language[0].metrics.blockPrecision, 1 / 2);
});

test('空分母返回 null，保留全零计数', () => {
  const empty = Engine.runEvaluation([]);
  Object.values(empty.metrics).forEach(v => assert.equal(v, null));
  assert.equal(empty.total, 0);
  const unknown = Engine.runEvaluation([sample('u', 'unclear', '语境待核', null)]);
  assert.equal(unknown.metrics.recall, null);
  assert.equal(unknown.metrics.reviewRate, 0);
});

test('仅冻结候选后开放留出集，对比报告按划分返回', () => {
  const rows = [sample('d', 'You are an idiot.', '辱骂骚扰', '人工复核'), sample('h', 'I will kill you.', '暴力威胁', '拦截', { split: '留出集' })];
  const config = { reviewThreshold: 35, blockThreshold: 95 };
  assert.equal(Engine.strategyCompare(rows, {}, config).holdout, null);
  const frozen = Engine.freezeStrategy(config);
  assert.ok(Object.isFrozen(frozen.config));
  config.blockThreshold = 30;
  assert.equal(frozen.config.blockThreshold, 95);
  const r = Engine.strategyCompare(rows, {}, frozen);
  assert.equal(r.dev.baseline.total, 1);
  assert.equal(r.holdout.candidate.total, 1);
  assert.equal(r.holdout.changed[0].action, '人工复核');
});

test('HTML 类输入始终作为普通文本，模块不执行脚本或访问 DOM', () => {
  globalThis.__comment_test_xss = 0;
  const input = '<img src=x onerror="globalThis.__comment_test_xss=1"><script>globalThis.__comment_test_xss=2</script>';
  assert.equal(Engine.evaluate({ text: input }).action, '放行');
  assert.equal(globalThis.__comment_test_xss, 0);
  delete globalThis.__comment_test_xss;
});

test('同一文件可在无构建浏览器环境加载', () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../engine/comment-engine.js'), 'utf8'), browser);
  assert.equal(browser.window.CommentEngine.evaluate({ text: 'Merci !' }).action, '放行');
  assert.equal(browser.window.CommentEngine.engineType, '可解释规则演示');
});

test('处置事件可重复读取，相同编号的冲突内容被拒绝', () => {
  const e = { eventId: 'evt-1', sampleId: '__proto__', action: '人工复核', strategyId: '规则一' };
  const first = Engine.applyDisposition(null, e);
  const replay = Engine.applyDisposition(first.state, e);
  assert.equal(first.applied, true);
  assert.equal(replay.applied, false);
  assert.equal(replay.state.events.length, 1);
  assert.equal(replay.state.latest.__proto__.action, '人工复核');
  assert.equal({}.action, undefined);
  assert.throws(() => Engine.applyDisposition(first.state, { ...e, action: '拦截' }), /冲突/);
  assert.throws(() => Engine.applyDisposition(null, { eventId: 'e', sampleId: 's', action: '删除' }), TypeError);
});
