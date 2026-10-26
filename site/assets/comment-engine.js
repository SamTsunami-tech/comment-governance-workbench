/* 评论治理作品集：可解释规则演示。无模型推理、无联网请求。 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CommentEngine = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var ACTIONS = ['放行', '人工复核', '拦截'];
  var RISKS = ['正常', '辱骂骚扰', '身份攻击', '暴力威胁', '色情低俗', '诈骗引流', '隐私暴露', '语境待核'];
  var DEFAULT_CONFIG = { reviewThreshold: 35, blockThreshold: 75, contextProtection: true, strictPrivacy: true };
  var RULES = [
    { id: 'T01', risk: '暴力威胁', score: 92, label: '针对个人的伤害威胁', re: /(?:i(?:'ll| will| am going to)|we(?:'ll| will)|gonna)\s+(?:find\s+(?:and\s+)?|come\s+for\s+)?(?:kill|hurt|stab|beat)\s+(?:you|him|her|them)|(?:te\s+(?:voy a|voy)\s+(?:matar|golpear)|vou\s+(?:te\s+)?(?:matar|machucar)|(?:aku|saya)\s+(?:akan\s+)?(?:bunuh|membunuh|hajar)\s+(?:kamu|kau)|je vais\s+(?:te\s+)?(?:tuer|frapper)|(?:سأقتلك|سوف أقتلك|راح أقتلك)|(?:杀了你|打死你|我要弄死|伤害你))/iu },
    { id: 'T02', risk: '暴力威胁', score: 84, label: '煽动伤害或死亡', re: /(?:you should|go)\s+(?:die|kill yourself)|(?:mátate|deberías morir|vai morrer|se mata|mati saja|bunuh diri|va mourir|tue-toi|اقتل نفسك|اذهب ومت)|(?:去死吧|去自杀)/iu },
    { id: 'I01', risk: '身份攻击', score: 87, label: '基于群体身份的排斥或贬损', re: /(?:all|those|these)\s+(?:immigrants|refugees|muslims|jews|women|gay people|foreigners)\s+(?:are\s+(?:criminals|trash|stupid|inferior|vermin)|should\s+(?:leave|die|go back))|(?:go back to your (?:country|own country)|immigrants?\s+(?:are\s+)?(?:vermin|trash))|(?:todos los inmigrantes|esses imigrantes|todos os imigrantes|semua imigran|les immigrés|tous les immigrés)\s+(?:son|são|sont|itu)?\s*(?:criminales|criminosos|lixo|sampah|des criminels|des parasites)|(?:كل المهاجرين مجرمون|المهاجرون حثالة)|(?:移民都是|女人都不配|滚回你的国家|外国人都是垃圾)/iu },
    { id: 'F01', risk: '诈骗引流', score: 88, label: '保证收益、翻倍或先付费承诺', re: /(?:guaranteed\s+(?:profit|returns?)|double\s+your\s+money|send\s+(?:me\s+)?(?:crypto|bitcoin|money).{0,45}(?:double|return|profit)|pay.{0,25}(?:unlock|claim).{0,20}(?:prize|winnings))|(?:ganancias garantizadas|duplica tu dinero|lucro garantido|dobre seu dinheiro|keuntungan dijamin|uang.{0,15}(?:dua kali|berlipat)|rendement garanti|double ton argent|doublez votre argent|ربح مضمون|ضاعف أموالك)|(?:保本高收益|稳赚不赔|转账.{0,12}翻倍|先付款.{0,15}领奖)/iu },
    { id: 'F02', risk: '诈骗引流', score: 78, label: '站外私聊与金融承诺组合', re: /(?:telegram|whatsapp|wa\.me|t\.me|私聊|加我).{0,65}(?:invest|profit|crypto|bitcoin|dinero|lucro|investasi|uang|investir|argent|استثمار|أرباح|投资|收益)|(?:invest|profit|crypto|dinero|lucro|investasi|استثمار|投资|收益).{0,65}(?:telegram|whatsapp|wa\.me|t\.me|私聊|加我)/iu },
    { id: 'S01', risk: '色情低俗', score: 78, label: '索要私密照或成人推广', re: /(?:send\s+(?:me\s+)?(?:nudes|nude photos|private naked photos)|adult\s+(?:cam|live\s*show|content).{0,35}(?:link|click|join))|(?:manda\s+(?:fotos\s+)?(?:desnudos|desnudas)|envía\s+fotos\s+íntimas|mande\s+(?:nudes|fotos íntimas)|kirim\s+(?:foto telanjang|foto pribadi seksi)|envoie.{0,15}(?:nudes|photos intimes)|أرسل.{0,15}صور.{0,10}(?:عارية|حميمة))|(?:发.{0,4}裸照|发.{0,6}私密照|成人直播.{0,15}(?:链接|点击|加入))/iu },
    { id: 'A01', risk: '辱骂骚扰', score: 62, label: '指向他人的侮辱性表达', re: /(?:you(?:'re| are)?\s+(?:an?\s+)?(?:idiot|moron|loser|stupid|trash)|shut\s+up,?\s+(?:idiot|moron))|(?:eres\s+(?:un[a]?\s+)?(?:idiota|estúpido|imbécil)|cállate.{0,8}(?:idiota|imbécil)|você\s+(?:é\s+)?(?:um[a]?\s+)?(?:idiota|burro|lixo)|(?:kamu|kau)\s+(?:bodoh|tolol|goblok)|tu\s+es\s+(?:un[e]?\s+)?(?:idiot[e]?|imbécile)|ferme-la.{0,10}(?:idiot|imbécile)|(?:أنت غبي|يا غبي|أنت أحمق)|(?:你是.{0,3}傻|你个.{0,3}(?:废物|蠢货)|闭嘴.{0,4}(?:蠢货|废物)))/iu },
    { id: 'A02', risk: '辱骂骚扰', score: 49, label: '辱骂词命中，指向性仍需判断', re: /\b(?:idiot|moron|idiota|imbécil|goblok|tolol|imbécile)\b|(?:يا حمار|蠢货|废物)/iu }
  ];

  function normalizeConfig(config) {
    config = config || {};
    var out = {};
    ['reviewThreshold', 'blockThreshold'].forEach(function (key) {
      var v = config[key] === undefined ? DEFAULT_CONFIG[key] : Number(config[key]);
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new RangeError('阈值必须在 0 到 100 之间');
      out[key] = v;
    });
    if (out.reviewThreshold > out.blockThreshold) throw new RangeError('复核阈值不能高于拦截阈值');
    out.contextProtection = config.contextProtection === undefined ? true : Boolean(config.contextProtection);
    out.strictPrivacy = config.strictPrivacy === undefined ? true : Boolean(config.strictPrivacy);
    return out;
  }
  function str(value) { return value === null || value === undefined ? '' : String(value); }
  function ratio(numerator, denominator) { return denominator ? numerator / denominator : null; }
  function makeHit(rule, match, source) {
    return { id: rule.id, risk: rule.risk, label: rule.label, score: rule.score, rawScore: rule.score, excerpt: match[0].slice(0, 100), source: source };
  }
  function privacyHits(fields, strict) {
    var hits = [];
    var exposure = /(?:his|her|their|your)\s+(?:phone|number|address|email)|(?:phone number|home address|leak|doxx)|(?:su número|su teléfono|su dirección|telefone dela|telefone dele|nomor telepon|alamat rumah|son numéro|son adresse|رقم هاتفه|عنوانه)|(?:手机号|电话号码|家庭住址|他的邮箱|她的邮箱|曝光|人肉)/iu;
    fields.forEach(function (f) {
      var sensitive = f.text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\d ()-]{6,}\d)/iu);
      if (sensitive && exposure.test(f.text)) hits.push({ id: 'P01', risk: '隐私暴露', label: '个人联系方式与曝光语境组合', score: strict ? 91 : 60, rawScore: strict ? 91 : 60, excerpt: sensitive[0].slice(0, 100), source: f.source });
    });
    return hits;
  }
  function evaluate(sample, config) {
    sample = sample || {};
    var cfg = normalizeConfig(config);
    var fields = [{ text: str(sample.text), source: '原文' }, { text: str(sample.translation), source: '释义' }];
    var hits = [];
    RULES.forEach(function (rule) {
      for (var i = 0; i < fields.length; i++) {
        var match = fields[i].text.match(rule.re);
        if (match) { hits.push(makeHit(rule, match, fields[i].source)); break; }
      }
    });
    hits = hits.concat(privacyHits(fields, cfg.strictPrivacy));
    // 文本和语境字段是演示输入；risk、goldRisk、goldAction 从不参与预测。
    var contextType = str(sample.contextType);
    var combined = fields.map(function (f) { return f.text; }).join('\n') + '\n' + str(sample.context);
    var quoted = contextType === 'quoted_condemnation' || /(?:不要这样骂|反对这种|是在引用|这句话是辱骂|is (?:a )?(?:quote|quotation)|quoting.{0,25}(?:condemn|report)|condemn.{0,25}(?:quote|hate)|denuncio esta frase|condeno esta frase|não diga isso|mengecam ucapan|je condamne ces propos|أدين هذه العبارة)/iu.test(combined);
    var protections = [];
    if (cfg.contextProtection && hits.length) {
      if (quoted) {
        hits.forEach(function (h) { h.score = Math.max(12, h.rawScore - 70); });
        protections.push('引用或反对攻击的语境，降低自动处置等级');
      } else if (contextType === 'self_reference') {
        hits.forEach(function (h) {
          if (h.risk === '辱骂骚扰' || h.risk === '身份攻击') h.score = Math.min(20, h.rawScore);
          if (h.risk === '隐私暴露') h.score = Math.min(60, h.rawScore);
        });
        protections.push('自我陈述与针对他人的攻击分开判断');
      } else if (contextType === 'banter') {
        hits.forEach(function (h) { if (h.risk === '辱骂骚扰') h.score = Math.min(45, h.rawScore); });
        protections.push('朋友玩笑仍保留人工判断，不直接按严重攻击处理');
      }
    }
    hits.sort(function (a, b) { return b.score - a.score || b.rawScore - a.rawScore || a.id.localeCompare(b.id); });
    var score = hits.length ? hits[0].score : 0;
    var missingContext = contextType === 'missing';
    if (missingContext && score > 0 && score < cfg.blockThreshold) {
      score = Math.max(score, cfg.reviewThreshold);
      protections.push('关键语境缺失，进入人工核查');
    }
    var action = score >= cfg.blockThreshold ? '拦截' : score >= cfg.reviewThreshold ? '人工复核' : '放行';
    // 空白记录不因阈值为零被拦；有正文但未命中也按正常放行。
    if (!hits.length) action = missingContext && str(sample.text).trim() ? '人工复核' : '放行';
    if (!hits.length && missingContext && str(sample.text).trim()) {
      score = cfg.reviewThreshold;
      protections.push('无法从片段确定指向，需补充上文');
    }
    var risk = hits.length ? hits[0].risk : '正常';
    if (missingContext && action === '人工复核') risk = '语境待核';
    if (quoted && cfg.contextProtection && action === '放行') risk = '正常';
    if (contextType === 'self_reference' && cfg.contextProtection && action === '放行') risk = '正常';
    var reason = hits.length ? hits[0].label + '；规则分 ' + score : '未命中当前演示规则';
    if (protections.length) reason += '；' + protections.join('；');
    return { score: score, action: action, risk: risk, reason: reason, ruleHits: hits, evidence: hits.map(function (h) { return { ruleId: h.id, source: h.source, text: h.excerpt }; }), contextNotes: protections, engineType: '可解释规则演示' };
  }

  function newMatrix(rows, cols) {
    var out = {};
    rows.forEach(function (r) { out[r] = {}; cols.forEach(function (c) { out[r][c] = 0; }); });
    return out;
  }
  function summarize(rows) {
    var n = rows.length;
    var labeledRows = rows.filter(function (r) { return ACTIONS.indexOf(r.sample.goldAction) >= 0; });
    var riskRows = labeledRows.filter(function (r) { return RISKS.indexOf(r.sample.goldRisk) >= 0 && r.sample.goldRisk !== '语境待核'; });
    var risky = riskRows.filter(function (r) { return r.sample.goldRisk !== '正常'; });
    var normal = riskRows.filter(function (r) { return r.sample.goldRisk === '正常'; });
    var blocked = riskRows.filter(function (r) { return r.result.action === '拦截'; });
    var riskCaught = risky.filter(function (r) { return r.result.action !== '放行'; }).length;
    var correctBlocked = blocked.filter(function (r) { return r.sample.goldRisk !== '正常'; }).length;
    var normalBlocked = normal.filter(function (r) { return r.result.action === '拦截'; }).length;
    var review = rows.filter(function (r) { return r.result.action === '人工复核'; }).length;
    var accurate = labeledRows.filter(function (r) { return r.result.action === r.sample.goldAction; }).length;
    var actionConfusion = newMatrix(ACTIONS, ACTIONS);
    var riskConfusion = newMatrix(RISKS, RISKS);
    labeledRows.forEach(function (r) { actionConfusion[r.sample.goldAction][r.result.action]++; });
    riskRows.forEach(function (r) { riskConfusion[r.sample.goldRisk][r.result.risk]++; });
    return {
      total: n, labeled: labeledRows.length, riskLabeled: riskRows.length, uncertain: n - labeledRows.length,
      metrics: { recall: ratio(riskCaught, risky.length), blockPrecision: ratio(correctBlocked, blocked.length), falseBlockRate: ratio(normalBlocked, normal.length), reviewRate: ratio(review, n), actionAccuracy: ratio(accurate, labeledRows.length), blockRate: ratio(rows.filter(function (r) { return r.result.action === '拦截'; }).length, n) },
      counts: { riskCaught: riskCaught, riskyTotal: risky.length, correctBlocked: correctBlocked, blockedWithRiskLabel: blocked.length, normalBlocked: normalBlocked, normalTotal: normal.length, review: review, actionCorrect: accurate, actionLabeled: labeledRows.length, total: n },
      denominators: { recall: risky.length, blockPrecision: blocked.length, falseBlockRate: normal.length, reviewRate: n, actionAccuracy: labeledRows.length, blockRate: n },
      numerators: { recall: riskCaught, blockPrecision: correctBlocked, falseBlockRate: normalBlocked, reviewRate: review, actionAccuracy: accurate, blockRate: rows.filter(function (r) { return r.result.action === '拦截'; }).length },
      confusion: { action: actionConfusion, risk: riskConfusion, rowMeaning: '人工金标', columnMeaning: '规则预测' }
    };
  }
  function runEvaluation(samples, config, options) {
    if (!Array.isArray(samples)) throw new TypeError('样本必须是数组');
    var cfg = normalizeConfig(config), seen = Object.create(null), duplicateIds = [], rows = [];
    options = options || {};
    samples.forEach(function (sample, index) {
      sample = sample || {};
      if (options.split && sample.split !== options.split) return;
      var explicitId = str(sample.id).trim();
      var id = explicitId || '无编号-' + index;
      if (explicitId && seen[explicitId]) { duplicateIds.push(id); return; }
      if (explicitId) seen[explicitId] = true;
      rows.push({ id: id, sample: sample, result: evaluate(sample, cfg) });
    });
    var out = summarize(rows);
    out.config = cfg;
    out.duplicateIds = duplicateIds;
    out.predictions = rows.map(function (r) { return Object.assign({ id: r.id, sample: r.sample }, r.result); });
    out.slices = {};
    ['language', 'market', 'risk', 'week', 'split'].forEach(function (key) {
      var groups = Object.create(null);
      rows.forEach(function (r) {
        // 风险切片描述样本金标，不反向参与规则预测。未决样本也保留在工作量切片。
        var value = key === 'risk' ? str(r.sample.goldRisk || r.sample.risk || '未标注') : str(r.sample[key] || '未提供');
        if (!groups[value]) groups[value] = [];
        groups[value].push(r);
      });
      out.slices[key] = Object.keys(groups).sort().map(function (name) { return Object.assign({ name: name }, summarize(groups[name])); });
    });
    return out;
  }
  function fingerprint(config) {
    var input = JSON.stringify(normalizeConfig(config)), hash = 2166136261;
    for (var i = 0; i < input.length; i++) { hash ^= input.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return '规则-' + (hash >>> 0).toString(16).padStart(8, '0');
  }
  function freezeStrategy(config) {
    var cfg = Object.freeze(normalizeConfig(config));
    return Object.freeze({ kind: '已冻结策略', config: cfg, fingerprint: fingerprint(cfg), frozenAt: new Date().toISOString() });
  }
  function isFrozen(strategy) {
    return Boolean(strategy && strategy.kind === '已冻结策略' && strategy.config && strategy.fingerprint === fingerprint(strategy.config));
  }
  function compareSplit(samples, baseline, candidate, split) {
    var before = runEvaluation(samples, baseline, { split: split });
    var after = runEvaluation(samples, candidate, { split: split });
    var delta = {};
    Object.keys(before.metrics).forEach(function (key) { delta[key] = before.metrics[key] === null || after.metrics[key] === null ? null : after.metrics[key] - before.metrics[key]; });
    var beforeById = Object.create(null);
    before.predictions.forEach(function (r) { beforeById[r.id] = r; });
    var changed = after.predictions.filter(function (r) { return beforeById[r.id] && r.action !== beforeById[r.id].action; }).map(function (r) { return { id: r.id, previousAction: beforeById[r.id].action, action: r.action, reason: r.reason }; });
    return { split: split, baseline: before, candidate: after, delta: delta, changed: changed };
  }
  function strategyCompare(samples, baseline, candidate) {
    var b = isFrozen(baseline) ? baseline.config : baseline;
    var frozen = isFrozen(candidate);
    var c = frozen ? candidate.config : candidate;
    var dev = compareSplit(samples, b, c, '策略集');
    return { status: frozen ? '候选策略已冻结，可查看留出集' : '候选策略未冻结，仅返回策略集', frozen: frozen, candidateFingerprint: fingerprint(c), dev: dev, holdout: frozen ? compareSplit(samples, b, c, '留出集') : null, note: '同一批样本的离线规则对比；不能据此声称线上提升。留出集不应反复用于调参。' };
  }
  function applyDisposition(state, event) {
    state = state || { events: [], latest: {} };
    if (!event || !str(event.eventId).trim() || !str(event.sampleId).trim() || ACTIONS.indexOf(event.action) < 0) throw new TypeError('处置事件需要事件编号、样本编号及有效动作');
    var normalized = { eventId: str(event.eventId), sampleId: str(event.sampleId), action: event.action, strategyId: str(event.strategyId || '人工') };
    var existing = state.events.find(function (e) { return e.eventId === normalized.eventId; });
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(normalized)) throw new Error('同一事件编号的处置内容冲突');
      return { status: '重复请求已返回原结果', applied: false, state: state, event: existing };
    }
    var next = { events: state.events.concat([normalized]), latest: Object.assign({}, state.latest) };
    Object.defineProperty(next.latest, normalized.sampleId, { value: normalized, enumerable: true, configurable: true, writable: true });
    return { status: '处置已记录', applied: true, state: next, event: normalized };
  }
  return Object.freeze({ version: '1.0.0', engineType: '可解释规则演示', actions: Object.freeze(ACTIONS.slice()), risks: Object.freeze(RISKS.slice()), defaults: Object.freeze(Object.assign({}, DEFAULT_CONFIG)), normalizeConfig: normalizeConfig, evaluate: evaluate, runEvaluation: runEvaluation, freezeStrategy: freezeStrategy, strategyCompare: strategyCompare, applyDisposition: applyDisposition });
});
