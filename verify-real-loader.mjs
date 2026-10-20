// 用 DSH 自己的 loadOverlayPatches + composeEntries 校验插件 patch，
// 这是宿主真正的接受路径（而不是自己复刻一份校验逻辑）。
// 四个预设都要过，并确认记忆行（文件 / 变量 / 写入工具）没有串。
// 本机没有可读的 dsh-app-boot（例如 CI / Desktop 的 app.asar）时优雅跳过。
import { pathToFileURL } from 'node:url';
import { requireHostPackage } from './lib/dsh-root.mjs';

const DSH_ROOT = requireHostPackage('dsh-app-boot');
const boot = await import(
  pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href
);

const patchFile = (process.argv[2] ?? '').trim() || 'cordis.patch.yml';

const patches = boot.loadOverlayPatches('dsh', patchFile);
console.log('loadOverlayPatches OK, patch units:', patches.length);

const entries = boot.composeEntries([patches]);

// composeEntries 返回的是嵌套数组；展平看行
const rows = [];
const walk = (list) => {
  for (const r of list) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      rows.push(r);
      if (Array.isArray(r.config)) walk(r.config);
    } else if (Array.isArray(r)) walk(r);
  }
};
walk(Array.isArray(entries) ? entries : [entries]);

console.log('composed rows:', rows.length);
for (const r of rows) {
  console.log(
    '  row id=' + JSON.stringify(r.id) + ' name=' + JSON.stringify(r.name) +
      (r.group ? ' [group]' : '') + (r.disabled !== undefined ? ' disabled=!!js' : ''),
  );
}

const WANT = [
  {
    id: '鲸鱼娘Agent预设',
    file: 'whale-loli.md',
    variable: 'whale_memory',
    tool: 'whale_memory_add',
    turns: 80,
  },
  {
    id: '鲸鱼娘活人版Agent预设',
    file: 'whale-loli-v2-live.md',
    variable: 'whale_memory_v2',
    tool: 'whale_memory_v2_add',
    turns: 80,
  },
  {
    id: '鲸鱼娘涩涩版Agent预设',
    file: 'whale-loli-v3-naughty.md',
    variable: 'whale_memory_v3',
    tool: 'whale_memory_v3_add',
    turns: 80,
  },
  {
    id: '鲸鱼娘女儿版Agent预设',
    file: 'dsh-whale-daughter.md',
    variable: 'whale_memory_v4',
    tool: 'whale_memory_v4_add',
    turns: 80,
  },
];

let ok = true;
const files = new Set();
const vars = new Set();
const tools = new Set();

for (const want of WANT) {
  const preset = rows.find((r) => r.id === `preset-${want.id}`);
  console.log(`\n--- preset row「${want.id}」---`);
  if (!preset) {
    console.error('FAIL: preset row missing');
    ok = false;
    continue;
  }
  console.log('config.id      =', JSON.stringify(preset.config.id));
  console.log('config.name    =', JSON.stringify(preset.config.name));
  console.log('config.order   =', preset.config.order);
  console.log('config.plugins =', preset.config.plugins.map((p) => p.id).join(', '));

  const mem = preset.config.plugins.find((p) => p.id === 'whale-memory');
  console.log(
    'memory row     =',
    mem
      ? `file=${mem.config.file} variable=${mem.config.variableName} tool=${mem.config.toolName} turnLimit=${mem.config.turnLimit}`
      : 'MISSING',
  );
  if (!mem) {
    ok = false;
    continue;
  }
  const bad = (msg) => {
    console.error('  FAIL: ' + msg);
    ok = false;
  };
  if (mem.config.file !== want.file) bad(`记忆文件应为 ${want.file}，实为 ${mem.config.file}`);
  if (mem.config.variableName !== want.variable) bad(`变量名应为 ${want.variable}，实为 ${mem.config.variableName}`);
  if (mem.config.toolName !== want.tool) bad(`写入工具应为 ${want.tool}，实为 ${mem.config.toolName}`);
  if (mem.config.turnLimit !== want.turns) bad(`turnLimit 应为 ${want.turns}，实为 ${mem.config.turnLimit}`);
  // complete 预设里独立 section 会被宿主丢掉，配了就是死配置
  if (mem.config.sectionName !== undefined) bad('不应再配置 sectionName（complete 预设会丢弃独立 section）');

  for (const [set, v, label] of [
    [files, mem.config.file, '记忆文件'],
    [vars, mem.config.variableName, '变量名'],
    [tools, mem.config.toolName, '写入工具名'],
  ]) {
    if (set.has(v)) bad(`${label} 重复: ${v}`);
    set.add(v);
  }
}

if (files.size !== WANT.length) {
  console.error('\nFAIL: 记忆文件未隔离');
  ok = false;
}
if (vars.size !== WANT.length) {
  console.error('\nFAIL: 变量名未隔离');
  ok = false;
}
if (tools.size !== WANT.length) {
  console.error('\nFAIL: 写入工具名未隔离');
  ok = false;
}
console.log('\n记忆文件:', [...files].join(', '));
console.log('变量名  :', [...vars].join(', '));
console.log('写入工具:', [...tools].join(', '));
console.log(ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
