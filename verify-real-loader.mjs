// 用 DSH 自己的 loadOverlayPatches + composeEntries 校验插件 patch，
// 这是宿主真正的接受路径（而不是自己复刻一份校验逻辑）。
import { pathToFileURL } from 'node:url';

const DSH_ROOT = 'C:/Users/35453/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh';
const boot = await import(
  pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href
);

const patchFile = process.argv[2].replace(/\\/g, '/');

const patches = boot.loadOverlayPatches('dsh', patchFile);
console.log('loadOverlayPatches OK, patch units:', patches.length);

const entries = boot.composeEntries([patches]);
const flat = boot.composeEntries([patches]).flat
  ? (await import(pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href))
  : null;

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
  console.log('  row id=' + JSON.stringify(r.id) + ' name=' + JSON.stringify(r.name) +
    (r.group ? ' [group]' : '') + (r.disabled !== undefined ? ' disabled=!!js' : ''));
}

const preset = rows.find((r) => r.id === 'preset-鲸鱼娘Agent预设');
if (!preset) { console.error('FAIL: preset row missing'); process.exit(1); }
console.log('--- preset row ---');
console.log('config.id      =', JSON.stringify(preset.config.id));
console.log('config.name    =', JSON.stringify(preset.config.name));
console.log('config.description =', JSON.stringify(preset.config.description));
console.log('config.order   =', preset.config.order);
console.log('config.plugins =', preset.config.plugins.map((p) => p.id).join(', '));
console.log('OK');
