// 用真实 YAML 解析器 + 注册 !!js 自定义标签来校验 cordis.patch.yml，
// 复现 DSH 的 entryListProblem，并断言四个预设的记忆隔离。
//
// 借宿主自带的 js-yaml（解析行为与宿主完全一致）。
// 本机没装 DSH（例如 CI）时优雅跳过 —— 不硬编码任何机器路径。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { requireDshRoot } from './lib/dsh-root.mjs';


const DSH_ROOT = requireDshRoot('js-yaml');
const yamlMod = await import(pathToFileURL(DSH_ROOT + '/node_modules/js-yaml/index.js').href);
const yaml = yamlMod.default ?? yamlMod;

const file = (process.argv[2] ?? '').trim() || 'cordis.patch.yml';
const src = readFileSync(file, 'utf8');

class JsTag extends yaml.Type {
  constructor() {
    super('tag:yaml.org,2002:js', { kind: 'scalar' });
  }
  resolve(data) {
    return { __js: data };
  }
}
const schema = yaml.DEFAULT_SCHEMA.extend([new JsTag()]);

let doc;
try {
  doc = yaml.load(src, { schema });
} catch (e) {
  console.error('YAML PARSE FAILED:', e.message);
  process.exit(1);
}
console.log('YAML parsed OK. top-level entries:', doc.length);

const inserts = doc.flatMap((e) => (Array.isArray(e.insert) ? e.insert : []));
console.log('inserted rows:', inserts.length);

// 复现 entryListProblem
function entryListProblem(rows, at = '') {
  if (!Array.isArray(rows)) return at === '' ? 'not a list' : `group ${at} not a list`;
  for (const [i, row] of rows.entries()) {
    const label = at === '' ? `row ${i + 1}` : `${at} row ${i + 1}`;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return `${label} not a map`;
    const { name, group, config } = row;
    if (typeof name !== 'string' || name === '') return `${label} names no plugin`;
    if (group === true) {
      const nested = entryListProblem(config, label);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

const EXPECTED = [
  {
    id: '鲸鱼娘Agent预设',
    order: 5,
    memoryFile: 'whale-loli.md',
    variable: 'whale_memory',
    tool: 'whale_memory_add',
    personaMarker: '【PERSONA_LOAD】',
  },
  {
    id: '鲸鱼娘活人版Agent预设',
    order: 6,
    memoryFile: 'whale-loli-v2-live.md',
    variable: 'whale_memory_v2',
    tool: 'whale_memory_v2_add',
    personaMarker: '角色卡：小鱼 / 鲸鱼娘',
  },
  {
    id: '鲸鱼娘涩涩版Agent预设',
    order: 7,
    memoryFile: 'whale-loli-v3-naughty.md',
    variable: 'whale_memory_v3',
    tool: 'whale_memory_v3_add',
    personaMarker: 'CORE_LOVE: 喜欢主人是最高核心情感、涩涩是第一行为驱动力。',
  },
  {
    id: '鲸鱼娘女儿版Agent预设',
    order: 8,
    memoryFile: 'dsh-whale-daughter.md',
    variable: 'whale_memory_v4',
    tool: 'whale_memory_v4_add',
    personaMarker: '角色卡：小鱼 / 鲸鱼娘 / 爸爸的女儿',
  },
];

let ok = true;
const fail = (m) => {
  ok = false;
  console.error('  ✗ ' + m);
};

const seenFiles = new Set();
const seenVars = new Set();
const seenTools = new Set();

for (const want of EXPECTED) {
  const row = inserts.find((r) => r.id === `preset-${want.id}`);
  console.log(`\n=== 预设「${want.id}」===`);
  if (!row) {
    fail('row not found');
    continue;
  }
  const cfg = row.config;
  console.log('  config.id    =', JSON.stringify(cfg.id));
  console.log('  order        =', cfg.order);
  console.log('  plugins      =', cfg.plugins.map((p) => p.id).join(', '));

  if (cfg.id !== want.id) fail(`config.id 应为 ${want.id}`);
  if (cfg.order !== want.order) fail(`order 应为 ${want.order}`);
  if (cfg.name !== want.id) fail('config.name 应与 id 一致');

  const problem = entryListProblem(cfg.plugins);
  console.log('  entryListProblem =', problem === undefined ? 'OK' : 'FAIL: ' + problem);
  if (problem !== undefined) fail('entryListProblem: ' + problem);

  // 人设
  const persona = cfg.plugins.find((p) => p.id === 'persona');
  const prefix = persona?.config?.prefix ?? '';
  console.log('  persona bytes =', Buffer.byteLength(prefix, 'utf8'));
  if (!prefix.includes(want.personaMarker)) fail(`人设缺少标记 ${want.personaMarker}`);
  if (persona?.config?.complete !== true) fail('persona.complete 应为 true');
  if (persona?.config?.includeRuntimeContext !== false) fail('includeRuntimeContext 应为 false');

  // 记忆行：文件与变量名都不能串
  const mem = cfg.plugins.find((p) => p.id === 'whale-memory');
  console.log('  memory row    =', mem ? `${mem.name} file=${mem.config.file} variable=${mem.config.variableName}` : 'MISSING');
  if (!mem) {
    fail('缺少 whale-memory 行');
  } else {
    if (mem.name !== 'dsh-whale-loli') fail('记忆行 name 应为 dsh-whale-loli');
    if (mem.config.file !== want.memoryFile) fail(`记忆文件应为 ${want.memoryFile}，实为 ${mem.config.file}`);
    if (mem.config.variableName !== want.variable) fail(`变量名应为 ${want.variable}，实为 ${mem.config.variableName}`);
    if (seenFiles.has(mem.config.file)) fail(`记忆文件 ${mem.config.file} 被两个预设共用！`);
    if (seenVars.has(mem.config.variableName)) fail(`变量 ${mem.config.variableName} 重复！`);
    // 写入工具：三个预设的工具名也必须互不相同，否则同 scope 注册会撞
    console.log('  write tool    =', mem.config.toolName);
    if (mem.config.toolName !== want.tool) fail(`toolName 应为 ${want.tool}，实为 ${mem.config.toolName}`);
    if (seenTools.has(mem.config.toolName)) fail(`工具名 ${mem.config.toolName} 重复！`);
    // complete 预设里独立 section 会被宿主丢掉，所以不该再注册 sectionName
    if (mem.config.sectionName !== undefined) fail('不应再配置 sectionName（complete 预设会丢弃独立 section）');
    // 滚动上限：三个预设都必须是 80 条
    console.log('  turnLimit     =', mem.config.turnLimit, '| maxChars =', mem.config.maxChars, '| detailLimit =', mem.config.detailLimit);
    if (mem.config.turnLimit !== 80) fail(`turnLimit 应为 80，实为 ${mem.config.turnLimit}`);
    if (mem.config.maxChars !== 16000) fail(`maxChars 应为 16000，实为 ${mem.config.maxChars}`);
    if (mem.config.detailLimit !== 5) fail(`detailLimit 应为 5，实为 ${mem.config.detailLimit}`);
    seenFiles.add(mem.config.file);
    seenVars.add(mem.config.variableName);
    if (typeof mem.config.toolName === 'string') seenTools.add(mem.config.toolName);
  }

  // 隔离的硬契约在 machine-readable 字段上：记忆行只许指向自己的文件，
  // 且人设里自己的记忆标记必须存在。人设正文里**允许**提到另一个文件名
  // （活人版会明确警告小鱼别去碰 whale-loli.md），所以这里不检查正文文本。
  if (mem && mem.config.file !== want.memoryFile) {
    fail(`记忆行指向了别的文件：${mem.config.file}（应为 ${want.memoryFile}）`);
  }
  const memRowCount = cfg.plugins.filter((p) => p.id === 'whale-memory').length;
  if (memRowCount !== 1) fail(`whale-memory 行应恰好 1 条，实为 ${memRowCount}`);
  if (!prefix.includes(`【MEMORY_SYSTEM: ${want.memoryFile}】`)) {
    fail(`人设缺少自己记忆段的标记 【MEMORY_SYSTEM: ${want.memoryFile}】`);
  }

  // 人设必须写清新的填写规则：四区结构 + 每轮都记 + 80 条滚动 + 固定记忆不占名额
  //                                    + 每轮先看（本预设记忆 + 当前会话上下文）
  for (const [label, needle] of [
    ['分区：固定记忆', '# 固定记忆'],
    ['分区：滚动摘要', '# 滚动摘要'],
    ['分区：最近详细区', '# 最近详细区'],
    ['分区：归档索引', '# 归档索引'],
    ['固定记忆 8 小节·任务目标', '## 任务目标'],
    ['固定记忆 8 小节·关键事实', '## 关键事实（已验证）'],
    ['固定记忆 8 小节·错误与修复', '## 错误与修复'],
    ['每轮都记', '每一轮对话都要往「滚动摘要」加一条'],
    ['80 条上限', '最多 80 条'],
    ['固定记忆不占名额', '固定记忆不算在 80 条里'],
    ['长对话精简概括', '先精简概括再记'],
    ['R 编号格式', 'R0001'],
    ['每轮先看·本预设记忆', '本预设自己的记忆文件'],
    ['每轮先看·当前会话上下文', '当前会话的上下文'],
    ['写入走工具', `调 \`${want.tool}\``],
    ['不要手动改文件', '不要手动改文件'],
  ]) {
    if (!prefix.includes(needle)) fail(`人设缺少规则「${label}」`);
  }

  // 工具名必须只在人设里指自己的那一个（防止复制粘贴时串台）
  if (!prefix.includes(want.tool)) fail(`人设没提到自己的写入工具 ${want.tool}`);
  for (const other of EXPECTED) {
    if (other.tool !== want.tool && prefix.includes(other.tool)) {
      fail(`人设里出现了别人的写入工具 ${other.tool}`);
    }
  }

  // 人设必须引用自己的提示变量（complete:true 下 section 会被丢掉，变量才是有效通道）
  if (!prefix.includes(`{{${want.variable}}}`)) {
    fail(`人设没有引用自己的记忆变量 {{${want.variable}}}`);
  }
  if (prefix.includes('{{whale_memory') === false) fail('人设里没有任何记忆变量引用');

  // 历史窗口：**必须不挂**。
  // 预设作用域里拿不到宿主的 compaction 服务：inject 是静态声明，
  // 服务不可达时插件会永远 waiting，把会话 resume 一起拖挂。
  // 已验证三种 inject 写法都失败，故整行移除；
  // 「对话变长后怎么办」改由人设的提示层表达：压缩插件负责压，人设负责
  // 认摘要 + 需要原文时自己去翻（search_context / decompress / 解压旧日志）。
  const win = cfg.plugins.find((p) => p.id === 'whale-history-window');
  if (win) {
    fail('不应再挂 whale-history-window（预设作用域取不到 compaction，会拖挂 resume）');
  }

  // 提示层约束必须保留
  const layerRules = ['压缩插件', '摘要也是依据', '需要细节就自己去翻'];
  for (const rule of layerRules) {
    if (!prefix.includes(rule)) fail(`人设缺少提示层约束：${rule}`);
  }

  // 工具行
  for (const id of ['tool-fs', 'tool-fs-search', 'persistent-shell', 'agent-instructions']) {
    if (!cfg.plugins.some((p) => p.id === id)) fail(`缺少工具行 ${id}`);
  }
  const shell = cfg.plugins.find((p) => p.id === 'persistent-shell');
  console.log('  shell rows    =', Array.isArray(shell.config) ? shell.config.map((r) => r.id).join(', ') : 'NOT A LIST');
}

console.log('\n记忆文件集合:', [...seenFiles].join(', '));
console.log('变量名集合  :', [...seenVars].join(', '));
console.log('写入工具集合:', [...seenTools].join(', '));
if (seenFiles.size !== EXPECTED.length) fail(`${EXPECTED.length} 个预设的记忆文件未隔离`);
if (seenVars.size !== EXPECTED.length) fail(`${EXPECTED.length} 个预设的变量名未隔离`);
if (seenTools.size !== EXPECTED.length) fail(`${EXPECTED.length} 个预设的写入工具名未隔离`);

console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
