// 用 DSH 自己的 loadOverlayPatches + composeEntries 校验插件 patch，
// 这是宿主真正的接受路径（而不是自己复刻一份校验逻辑）。
// 三个预设都要过，并确认记忆行没有串。
// 本机没有可读的 dsh-app-boot（例如 CI / Desktop 的 app.asar）时优雅跳过。
import { pathToFileURL } from 'node:url';
import { requireHostPackage } from './lib/dsh-root.mjs';

const DSH_ROOT = requireHostPackage('dsh-app-boot');
const boot = await import(
  pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href
);

const patchFile = process.argv[2].replace(/\\/g, '/');

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
  { id: '鲸鱼娘Agent预设', file: 'whale-loli.md', section: 'whale-loli-memory' },
  { id: '鲸鱼娘活人版Agent预设', file: 'whale-loli-v2-live.md', section: 'whale-loli-v2-live-memory' },
  {
    id: '鲸鱼娘涩涩版Agent预设',
    file: 'whale-loli-v3-naughty.md',
    section: 'whale-loli-v3-naughty-memory',
  },
];

let ok = true;
const files = new Set();

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
  console.log('memory row     =', mem ? `file=${mem.config.file} section=${mem.config.sectionName}` : 'MISSING');
  if (!mem) {
    ok = false;
    continue;
  }
  if (mem.config.file !== want.file) {
    console.error(`  FAIL: 记忆文件应为 ${want.file}，实为 ${mem.config.file}`);
    ok = false;
  }
  if (mem.config.sectionName !== want.section) {
    console.error(`  FAIL: section 应为 ${want.section}`);
    ok = false;
  }
  files.add(mem.config.file);
}

if (files.size !== WANT.length) {
  console.error('\nFAIL: 记忆文件未隔离');
  ok = false;
}
console.log('\n记忆文件:', [...files].join(', '));
console.log(ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
