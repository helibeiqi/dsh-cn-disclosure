// dsh-cn-disclosure — 零依赖本地优先 A股 公告/年报 结构化抽取 MCP server
// 协议: MCP stdio (NDJSON), protocolVersion 2024-11-05.
// 数据: ./data/disclosure-rules.json (人工精选事件类型 + 跨格式抽取规则, 无需 API key / 网络).
// 设计: 格式容忍——对自由文本做正则扫描, 不假设任何公司/版式固定结构.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RULES_PATH = path.join(__dirname, 'data', 'disclosure-rules.json');

const log = (...a) => process.stderr.write('[cn-disc] ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');

let RULES = null;
let EVENTS = [];        // [{id,name,direction,category,aliases[]}]
let ALIAS_IDX = [];     // [{alias, ev}] 扁平索引
let FIELDS = [];        // [{id,name,re,unit}]

function loadRules() {
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  RULES = JSON.parse(raw);
  EVENTS = RULES.event_types;
  ALIAS_IDX = [];
  for (const ev of EVENTS) for (const a of ev.aliases) ALIAS_IDX.push({ alias: a, ev });
  FIELDS = RULES.field_patterns.map(f => ({ ...f, re: new RegExp(f.regex, 'g') }));
  log('loaded rules:', EVENTS.length, 'event types,', FIELDS.length, 'field patterns');
}

// ---- 数值归一化 ----
function normalize(patId, num) {
  const n = parseFloat(num);
  switch (patId) {
    case 'amount_yi': return { raw: num + ' 亿元', value: n * 1e8, unit: '元' };
    case 'amount_wan': return { raw: num + ' 万元', value: n * 1e4, unit: '元' };
    case 'shares_yi': return { raw: num + ' 亿股', value: n * 1e8, unit: '股' };
    case 'shares_wan': return { raw: num + ' 万股', value: n * 1e4, unit: '股' };
    case 'pct': return { raw: num + ' %', value: n, unit: '%' };
    case 'yoy': return { raw: '同比 ' + num + ' %', value: n, unit: '%' };
    case 'eps': return { raw: num + ' 元', value: n, unit: '元/股' };
    case 'dividend_ps': return { raw: num, value: n, unit: '元/10股' };
    case 'date': return { raw: num, value: num, unit: 'date' };
    default: return { raw: num, value: n, unit: '?' };
  }
}

function findFields(text) {
  const out = [];
  for (const f of FIELDS) {
    f.re.lastIndex = 0;
    let m;
    while ((m = f.re.exec(text)) !== null) {
      out.push({ id: f.id, name: f.name, ...normalize(f.id, m[1]), snippet: text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20) });
      if (m.index === f.re.lastIndex) f.re.lastIndex++;
    }
  }
  return out;
}

function findDates(text, win) {
  const re = /\d{4}[-年./]\d{1,2}[-月./]\d{1,2}/g;
  const ds = [];
  let m; while ((m = re.exec(text)) !== null) ds.push(m[0]);
  return ds.slice(0, 3);
}

// ---- 分类 ----
function classify(text) {
  const hits = [];
  for (const ev of EVENTS) {
    const matched = ev.aliases.filter(a => text.includes(a));
    if (matched.length) hits.push({ id: ev.id, name: ev.name, direction: ev.direction, category: ev.category, score: matched.length, matched });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits;
}

// ---- 事件抽取（事件研究可用）----
function extractEvents(text) {
  const events = [];
  for (const ev of EVENTS) {
    const matched = ev.aliases.filter(a => text.includes(a));
    if (!matched.length) continue;
    // 取首个 alias 命中位置做窗口, 在窗口内抽日期/金额/股数/比例
    const firstAlias = matched[0];
    const pos = text.indexOf(firstAlias);
    const win = text.slice(Math.max(0, pos - 120), pos + 160);
    const fields = findFields(win);
    const yuanCands = fields.filter(f => f.unit === '元' || f.unit === '元/10股');
    const order = ev.id === 'dividend' ? ['元/10股', '元'] : ['元', '元/10股'];
    let amount = null;
    for (const u of order) { const f = yuanCands.find(x => x.unit === u); if (f) { amount = { value: f.value, unit: f.unit, raw: f.raw }; break; } }
    const shares = fields.find(f => f.unit === '股');
    const pct = fields.find(f => f.unit === '%');
    const dates = findDates(win);
    events.push({
      type: ev.id, name: ev.name, direction: ev.direction, category: ev.category,
      matched_aliases: matched,
      date: dates[0] || null,
      amount: amount ? { value: amount.value, unit: amount.unit, raw: amount.raw } : null,
      shares: shares ? { value: shares.value, unit: shares.unit, raw: shares.raw } : null,
      pct: pct ? { value: pct.value, unit: '%', raw: pct.raw } : null,
      snippet: win.replace(/\s+/g, ' ').slice(0, 200)
    });
  }
  return events;
}

// ---- meta 猜测（轻量启发, 允许为空）----
function guessMeta(text) {
  let issuer = null;
  let m = text.match(/(.{2,12}?(?:股份)?(?:有限公司|股份有限公司|集团))/);
  if (m) issuer = m[1].trim();
  let title = null;
  m = text.match(/关于[^，,。\n]{2,30}?(?:的公告|的报告|的提示性公告|的通知)/);
  if (m) title = m[0].trim();
  else { const line = text.split(/[\n\r]/)[0]; if (line && line.length <= 40) title = line.trim(); }
  return { issuer, title };
}

function stripHtml(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
}

// ============ 工具 ============
const TOOLS = [
  { name: 'extract_disclosure', description: '对一段 A股 公告/年报文本做结构化抽取：自动分类披露类型、提取日期/金额/比例/股数等字段、生成事件研究可用的结构化事件。支持跨公司/跨版式（正则扫描，不假设固定结构）。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '披露文本（公告正文 / 年报片段 / 复制的文本）' }, source_type: { type: 'string', description: '可选: annual_report / announcement / earnings_pre 等, 仅作元信息标注', nullable: true } }, required: ['text'] } },
  { name: 'classify_disclosure', description: '仅做披露类型分类（命中哪些事件类型 + 方向 + 匹配词）。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '披露文本' } }, required: ['text'] } },
  { name: 'extract_events', description: '抽取事件研究可用事件列表（类型/方向/日期/金额/股数/比例/原文片段）。', inputSchema: { type: 'object', properties: { text: { type: 'string', description: '披露文本' } }, required: ['text'] } },
  { name: 'extract_from_file', description: '读本地文件(.txt/.md/.html，html 自动去标签)后做结构化抽取。', inputSchema: { type: 'object', properties: { path: { type: 'string', description: '本地文件路径' } }, required: ['path'] } },
  { name: 'disclosure_stats', description: '返回规则集规模概览（事件类型数 / 字段规则数 / 版本）。', inputSchema: { type: 'object', properties: {} } },
];

function callTool(name, args) {
  args = args || {};
  try {
    if (name === 'extract_disclosure') {
      const src = String(args.text || '');
      const meta = guessMeta(src);
      const cls = classify(src);
      const fields = findFields(src);
      const events = extractEvents(src);
      const top = cls[0] || null;
      return text(`{
  "source_type": ${args.source_type ? JSON.stringify(args.source_type) : 'null'},
  "meta": ${JSON.stringify(meta)},
  "top_type": ${top ? JSON.stringify({ id: top.id, name: top.name, direction: top.direction }) : 'null'},
  "all_types": ${JSON.stringify(cls.map(c => ({ id: c.id, name: c.name, direction: c.direction, score: c.score })))},
  "fields": ${JSON.stringify(fields.map(f => ({ name: f.name, raw: f.raw, value: f.value, unit: f.unit })))},
  "events": ${JSON.stringify(events)},
  "caveats": "规则为基于自由文本的正则抽取, 对扫描版PDF需先转文本; 数值为字面识别, 未做会计口径校验; 多事件并列时均列出。"
}`);
    }
    if (name === 'classify_disclosure') {
      const cls = classify(String(args.text || ''));
      return text(JSON.stringify({ count: cls.length, types: cls }, null, 2));
    }
    if (name === 'extract_events') {
      const ev = extractEvents(String(args.text || ''));
      return text(JSON.stringify({ count: ev.length, events: ev }, null, 2));
    }
    if (name === 'extract_from_file') {
      const p = String(args.path || '');
      if (!fs.existsSync(p)) return text(`文件不存在: ${p}`);
      let raw = fs.readFileSync(p, 'utf8');
      if (/\.html?$/i.test(p)) raw = stripHtml(raw);
      const r = callTool('extract_disclosure', { text: raw, source_type: 'file:' + path.basename(p) });
      return r;
    }
    if (name === 'disclosure_stats') {
      return text(JSON.stringify({
        version: RULES.meta.version, source: RULES.meta.source,
        event_types: EVENTS.length, field_patterns: FIELDS.length
      }, null, 2));
    }
    return text(`未知工具: ${name}`);
  } catch (e) {
    return text('工具执行错误: ' + e.message);
  }
}
function text(s) { return { content: [{ type: 'text', text: s }] }; }

// ============ MCP stdio ============
const SERVER_INFO = { name: 'dsh-cn-disclosure', version: RULES ? RULES.meta.version : '0.1.0' };
function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const id = msg.id;
  if (msg.method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER_INFO } });
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (msg.method === 'tools/call') {
    const res = callTool(msg.params.name, msg.params.arguments || {});
    return send({ jsonrpc: '2.0', id, result: res });
  }
}
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk; let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    try { handle(JSON.parse(line)); } catch (e) { log('parse error:', e.message); }
  }
});
process.stdin.on('end', () => process.exit(0));
try { loadRules(); } catch (e) { log('FATAL load rules:', e.message); process.exit(1); }
log('server ready, pid', process.pid);
