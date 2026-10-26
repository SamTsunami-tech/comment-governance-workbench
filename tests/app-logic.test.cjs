/* 测试真实网页脚本的解析、校验与导出逻辑；仅使用 Node 内置模块。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const assets = path.resolve(__dirname, '../site/assets');
const plain = value => JSON.parse(JSON.stringify(value));
const row = (id = '导入-001', extra = {}) => ({
  id, text: 'Thanks for explaining.', language: '英语', ...extra,
});

function application() {
  const elements = new Map();
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, {
      innerHTML: '', textContent: '', children: [], style: {},
      addEventListener() {}, focus() {}, setSelectionRange() {},
      classList: { add() {}, remove() {} },
    });
    return elements.get(selector);
  };
  const document = {
    activeElement: null,
    querySelector: element,
    querySelectorAll: () => [],
    getElementById: id => element('#' + id),
    addEventListener() {},
    body: { style: {} },
  };
  const window = { addEventListener() {}, scrollTo() {}, __执行探针: 0 };
  const context = vm.createContext({
    window, document, location: { hash: '#queue' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, clearTimeout() {}, console, crypto: require('node:crypto'),
  });
  for (const file of ['comment-engine.js', 'samples.js', 'sources.js']) {
    vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), context, { filename: file });
  }
  const source = fs.readFileSync(path.join(assets, 'app.js'), 'utf8');
  const boot = /\n  render\(\);\s*\n\}\)\(\);\s*$/;
  assert.match(source, boot, '仅禁用脚本末尾的自动首次渲染；业务函数保持原样');
  vm.runInContext(source.replace(boot, '\n})();'), context, { filename: 'app.js' });
  assert.ok(window.评论治理应用, '必须加载真实应用公开接口');
  return { app: window.评论治理应用, window, elements, location: context.location };
}

test('内置场景为72条，策略集48条、留出集24条，编号唯一', () => {
  const { app } = application();
  const samples = app.samples();
  assert.equal(samples.length, 72);
  assert.equal(samples.filter(s => s.split === '策略集').length, 48);
  assert.equal(samples.filter(s => s.split === '留出集').length, 24);
  assert.equal(new Set(samples.map(s => s.id)).size, 72);
  assert.equal(new Set(samples.map(s => s.language)).size, 6);
});

test('五个页面使用真实模板和规则结果完成渲染', () => {
  const { app, elements, location } = application();
  for (const [route,title] of [['overview','治理总览'],['queue','评论工作台'],['samples','样本工作流'],['strategy','策略实验室'],['handoff','运营交付']]) {
    location.hash='#'+route;
    app.render();
    const html=elements.get('#main').innerHTML;
    assert.ok(html.includes(title),route);
    assert.ok(!html.includes('undefined'),route);
  }
  app.state.handoffTab='开源整合';app.render();
  assert.ok(elements.get('#main').innerHTML.includes('Apache ECharts'));
  assert.ok(elements.get('#main').innerHTML.includes('下载完整面试稿'));
});

test('保留编号不能作为样本键写入标注对象', () => {
  const { app } = application();
  const report = app.parseImport(JSON.stringify(['__proto__','constructor','prototype'].map(id=>row(id))), '输入.json');
  assert.equal(report.accepted.length, 0);
  assert.equal(report.errors.length, 3);
});

test('真实保存函数完成初审、分歧、裁决并在初审修订后清理下游', () => {
  const { app, elements } = application();
  const sample=app.samples()[0];
  app.inspect(sample.id);
  function save(role,risk,action,reason) {
    for (const [id,value] of Object.entries({'annotation-stage':role,'annotation-risk':risk,'annotation-action':action,'annotation-note':reason,'annotation-reason-code':'边界已明确'})) {
      if (!elements.has('#'+id)) elements.set('#'+id,{});
      elements.get('#'+id).value=value;
    }
    app.saveAnnotation(sample.id);
  }
  save('first','辱骂骚扰','人工复核','初审理由');
  assert.equal(app.workflow(sample),'待复审');
  save('second','正常','放行','复审认为是玩笑');
  assert.equal(app.workflow(sample),'待仲裁');
  save('adjudication','正常','放行','取得前文后裁决');
  assert.equal(app.workflow(sample),'已对齐');
  save('first','辱骂骚扰','拦截','补充新证据，修订初审');
  assert.equal(app.workflow(sample),'待复审');
  assert.equal(app.state.annotations[sample.id].second,undefined);
  assert.equal(app.state.adjudications[sample.id],undefined);
  assert.equal(app.state.history.length,4,'历史保留，不直接改写旧意见');
});

test('未提交复审时界面隐藏初审、规则建议与参考判定', () => {
  const { app, elements } = application();
  const sample=app.samples()[0];
  app.state.annotations[sample.id]={first:{risk:'辱骂骚扰',action:'拦截',reason:'不应出现在二审界面的初审理由'}};
  app.inspect(sample.id,'second');
  const html=elements.get('#overlay').innerHTML;
  assert.ok(html.includes('本次为独立复审'));
  assert.ok(!html.includes('不应出现在二审界面的初审理由'));
  assert.ok(html.includes('class="detail-section" hidden'));
  assert.ok(html.includes('class="reference-box" hidden'));
});

test('冻结记录保存参数副本及当次结果，后续参数编辑不改旧快照', () => {
  const { app } = application();
  app.freeze();
  const snapshot=app.state.experiments[0];
  assert.equal(snapshot.dev.candidate.total,48);
  assert.equal(snapshot.holdout.candidate.total,24);
  assert.equal(snapshot.dataIds.length,72);
  app.state.config.blockThreshold=90;
  assert.equal(snapshot.config.blockThreshold,75);
  assert.equal(snapshot.holdout.candidate.config.blockThreshold,75);
});

test('CSV解析支持BOM、逗号、转义双引号、字段内换行及CRLF', () => {
  const { app } = application();
  const csv = '\uFEFFid,text,language\r\nCSV-1,"He said ""hello, friend""\nSecond line",英语\r\nCSV-2,"Thanks",法语\r\n';
  const parsed = app.parseCSV(csv);
  assert.deepEqual(plain(parsed), [
    { id: 'CSV-1', text: 'He said "hello, friend"\nSecond line', language: '英语' },
    { id: 'CSV-2', text: 'Thanks', language: '法语' },
  ]);
  assert.equal(app.parseImport(csv, '输入.CSV').accepted.length, 2);
});

test('CSV未闭合引号给出错误，不产生静默截断的记录', () => {
  const { app } = application();
  assert.throws(() => app.parseCSV('id,text,language\n1,"unfinished,英语'), /引号未闭合/);
});

test('JSONL异常行中止本批次，并报告具体行号', () => {
  const { app } = application();
  const text = JSON.stringify(row('合法-1')) + '\n{bad json}\n' + JSON.stringify(row('合法-2'));
  assert.throws(() => app.parseImport(text, '输入.jsonl'), /第2行不是合法JSON/);
  assert.equal(app.samples().length, 72, '解析失败不应修改样本状态');
});

test('JSON数组与JSONL空行可读，空数组不增加样本', () => {
  const { app } = application();
  assert.equal(app.parseImport(JSON.stringify([row('数组-1')]), '输入.json').accepted.length, 1);
  assert.equal(app.parseImport('\n' + JSON.stringify(row('逐行-1')) + '\n\n', '输入.jsonl').accepted.length, 1);
  assert.equal(app.parseImport('[]', '输入.json').accepted.length, 0);
});

test('导入时跳过内置重复编号、同批重复编号及首尾空白后的重复', () => {
  const { app } = application();
  const report = app.parseImport(JSON.stringify([
    row('PL-001'), row('新-1'), row(' 新-1 '), row('新-1'), row('新-2'),
  ]), '输入.json');
  assert.equal(report.total, 5);
  assert.equal(report.duplicate, 3);
  assert.deepEqual(plain(report.accepted.map(s => s.id)), ['新-1', '新-2']);
});

test('100字符编号完整保留，101字符编号拒绝，避免截断碰撞', () => {
  const { app } = application();
  const id100 = 'A'.repeat(100);
  const report = app.parseImport(JSON.stringify([row(id100), row(id100 + 'B'), row(id100 + 'C')]), '输入.json');
  assert.equal(report.accepted.length, 1);
  assert.equal(report.accepted[0].id, id100);
  assert.equal(report.errors.length, 2);
  assert.equal(report.duplicate, 0);
});

test('未知语言、动作和风险分别拒绝，不自动制造有效金标', () => {
  const { app } = application();
  const report = app.parseImport(JSON.stringify([
    row('异常-1', { language: 'English' }),
    row('异常-2', { goldAction: '直接删除' }),
    row('异常-3', { goldRisk: '未知类别' }),
    row('合法-1', { goldAction: '放行', goldRisk: '正常' }),
  ]), '输入.json');
  assert.equal(report.errors.length, 3);
  assert.deepEqual(plain(report.accepted.map(s => s.id)), ['合法-1']);
});

test('缺少金标保持未决，只保留白名单字段，不接收伪造规则结果', () => {
  const { app } = application();
  const report = app.parseImport(JSON.stringify([row('白名单-1', {
    ruleResult: { score: 100, action: '拦截' }, workflow: '已对齐',
    contextType: '恶意类型', extra: '不应进入样本',
  })]), '输入.json');
  const sample = report.accepted[0];
  assert.equal(sample.goldAction, null);
  assert.equal(sample.goldRisk, '语境待核');
  assert.equal(sample.contextType, 'missing');
  assert.equal(Object.hasOwn(sample, 'ruleResult'), false);
  assert.equal(Object.hasOwn(sample, 'workflow'), false);
  assert.equal(Object.hasOwn(sample, 'extra'), false);
});

test('非对象、空正文和非字符串编号逐条报告，不吞掉合法记录', () => {
  const { app } = application();
  const report = app.parseImport(JSON.stringify([null, [], row(42), row('空正文', { text: '  ' }), row('有效')]), '输入.json');
  assert.equal(report.errors.length, 4);
  assert.deepEqual(plain(report.accepted.map(s => s.id)), ['有效']);
});

test('导入大小和条数边界有明确拒绝行为', () => {
  const { app } = application();
  assert.throws(() => app.parseImport('x'.repeat(2 * 1024 * 1024 + 1), '大文件.jsonl'), /2MB/);
  assert.throws(() => app.parseImport(JSON.stringify(Array.from({ length: 5001 }, (_, i) => row('容量-' + i))), '大批次.json'), /5000条/);
});

test('HTML正文作为文本保存，真实渲染函数输出转义内容', () => {
  const { app, window, elements } = application();
  const attack = '<img src=x onerror="window.__执行探针=1"><script>window.__执行探针=2</script>';
  const sample = app.parseImport(JSON.stringify([row('HTML-1', { text: attack })]), '输入.json').accepted[0];
  assert.equal(sample.text, attack);
  app.state.imported.push(sample);
  app.state.query = 'HTML-1';
  app.render();
  const html = elements.get('#main').innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=&quot;window.__执行探针=1&quot;&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>window.__执行探针'));
  assert.equal(window.__执行探针, 0);
});

test('Label Studio任务在data.sample_id保留业务编号，不输出字符串顶层id', () => {
  const { app } = application();
  const input = row('LS-业务编号', { context: '保留上下文', translation: '中文释义' });
  const task = app.labelTasks([input])[0];
  assert.equal(task.data.sample_id, 'LS-业务编号');
  assert.notEqual(typeof task.id, 'string');
  assert.equal(task.data.context, input.context);
  assert.equal(task.data.text, input.text);
  task.data.text = '导出对象的编辑';
  assert.equal(input.text, 'Thanks for explaining.');
});

test('标注配置字段与任务一致，并覆盖全部风险和处置选项', () => {
  const { app } = application();
  const xml = app.labelConfig();
  for (const variable of ['$text', '$translation', '$context']) assert.ok(xml.includes(variable));
  for (const choice of ['正常', '辱骂骚扰', '身份攻击', '暴力威胁', '色情低俗', '诈骗引流', '隐私暴露', '语境待核', '放行', '人工复核', '拦截']) {
    assert.ok(xml.includes('value="' + choice + '"'), choice);
  }
});

test('JSON导出完整保留引号、换行与HTML文本，不执行正文', () => {
  const { app, window } = application();
  const input = row('导出-1', { text: 'Quoted "word"\n<script>window.__执行探针=3</script>', context: '换行\n上下文' });
  const exported = app.sampleExport([input]);
  const recovered = JSON.parse(JSON.stringify(exported))[0];
  assert.equal(recovered.text, input.text);
  assert.equal(recovered.context, input.context);
  assert.equal(window.__执行探针, 0);
  assert.equal(input.ruleResult, undefined, '导出不向原始样本回写规则结果');
  exported[0].strategy.reviewThreshold = 99;
  assert.notEqual(app.state.config.reviewThreshold, 99, '导出策略不是状态对象本身');
});

test('导出后编辑人工标注或裁决记录，不改写工作流原状态', () => {
  const { app } = application();
  const input = row('引用-1');
  app.state.annotations[input.id] = { first: { risk: '正常', action: '放行', reason: '初审依据' } };
  app.state.adjudications[input.id] = { risk: '正常', action: '放行', reason: '裁决依据' };
  const exported = app.sampleExport([input])[0];
  exported.annotation.first.reason = '导出编辑';
  exported.adjudication.reason = '导出编辑';
  assert.equal(app.state.annotations[input.id].first.reason, '初审依据');
  assert.equal(app.state.adjudications[input.id].reason, '裁决依据');
});
