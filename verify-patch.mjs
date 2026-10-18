// 用真实 YAML 解析器 + 注册 !!js 自定义标签来校验 cordis.patch.yml，
// 复现 DSH 的 entryListProblem，并断言三个预设的记忆隔离。
//
// 借宿主自带的 js-yaml（解析行为与宿主完全一致）。
// 本机没装 DSH（例如 CI）时优雅跳过 —— 不硬编码任何机器路径。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { requireDshRoot } from './lib/dsh-root.mjs';


const DSH_ROOT = requireDshRoot('js-yaml');
const yamlMod = await import(pathToFileURL(DSH_ROOT + '/node_modules/js-yaml/index.js').href);
const yaml = yamlMod.default ?? yamlMod;

const file = process.argv[2];
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
    section: 'whale-loli-memory',
    personaMarker: '【PERSONA_LOAD】',
  },
  {
    id: '鲸鱼娘活人版Agent预设',
    order: 6,
    memoryFile: 'whale-loli-v2-live.md',
    section: 'whale-loli-v2-live-memory',
    personaMarker: '角色卡：小鱼 / 鲸鱼娘',
  },
  {
    id: '鲸鱼娘涩涩版Agent预设',
    order: 7,
    memoryFile: 'whale-loli-v3-naughty.md',
    section: 'whale-loli-v3-naughty-memory',
    personaMarker: 'CORE_LOVE: 喜欢主人是最高核心情感、涩涩是第一行为驱动力。',
  },
];

let ok = true;
const fail = (m) => {
  ok = false;
  console.error('  ✗ ' + m);
};

const seenFiles = new Set();
const seenSections = new Set();

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

  // 记忆行：文件与 section 都不能串
  const mem = cfg.plugins.find((p) => p.id === 'whale-memory');
  console.log('  memory row    =', mem ? `${mem.name} file=${mem.config.file} section=${mem.config.sectionName}` : 'MISSING');
  if (!mem) {
    fail('缺少 whale-memory 行');
  } else {
    if (mem.name !== 'dsh-whale-loli') fail('记忆行 name 应为 dsh-whale-loli');
    if (mem.config.file !== want.memoryFile) fail(`记忆文件应为 ${want.memoryFile}，实为 ${mem.config.file}`);
    if (mem.config.sectionName !== want.section) fail(`section 应为 ${want.section}`);
    if (seenFiles.has(mem.config.file)) fail(`记忆文件 ${mem.config.file} 被两个预设共用！`);
    if (seenSections.has(mem.config.sectionName)) fail(`section ${mem.config.sectionName} 重复！`);
    // 对话记录滚动上限：三个预设都必须是 80
    console.log('  turnLimit     =', mem.config.turnLimit, '| maxChars =', mem.config.maxChars);
    if (mem.config.turnLimit !== 80) fail(`turnLimit 应为 80，实为 ${mem.config.turnLimit}`);
    if (mem.config.maxChars !== 16000) fail(`maxChars 应为 16000，实为 ${mem.config.maxChars}`);
    seenFiles.add(mem.config.file);
    seenSections.add(mem.config.sectionName);
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

  // 人设必须写清新的填写规则：两个区 + 每轮都记 + 80 轮滚动 + 重要记忆不占名额
  for (const [label, needle] of [
    ['分区：重要记忆', '## 重要记忆'],
    ['分区：对话记录', '## 对话记录'],
    ['每轮都记', '每一轮对话都要往「对话记录」里加一条'],
    ['80 轮上限', '只保留最近 80 轮'],
    ['重要记忆不占名额', '这个名额**只算「对话记录」**'],
    ['长对话精简概括', '先精简概括再记'],
  ]) {
    if (!prefix.includes(needle)) fail(`人设缺少规则「${label}」`);
  }

  // 工具行
  for (const id of ['tool-fs', 'tool-fs-search', 'persistent-shell', 'agent-instructions']) {
    if (!cfg.plugins.some((p) => p.id === id)) fail(`缺少工具行 ${id}`);
  }
  const shell = cfg.plugins.find((p) => p.id === 'persistent-shell');
  console.log('  shell rows    =', Array.isArray(shell.config) ? shell.config.map((r) => r.id).join(', ') : 'NOT A LIST');
}

console.log('\n记忆文件集合:', [...seenFiles].join(', '));
console.log('section 集合 :', [...seenSections].join(', '));
if (seenFiles.size !== EXPECTED.length) fail(`${EXPECTED.length} 个预设的记忆文件未隔离`);
if (seenSections.size !== EXPECTED.length) fail(`${EXPECTED.length} 个预设的 section 名未隔离`);

console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
