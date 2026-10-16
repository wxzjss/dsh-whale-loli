// 组合级体检：把 bundle 层 + profile 层的全部 patch 合成，
// 检查 entryListProblem、重复 row id、预设注册冲突。
import { pathToFileURL } from 'node:url';

const DSH_ROOT = 'C:/Users/35453/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh';
const boot = await import(
  pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href
);

const bundleLayer = boot.loadOverlayPatches('dsh',
  'C:/Users/35453/Documents/deepseek-harness/default-workspace/dsh-whale-loli/cordis.patch.yml');
const profileLayer = boot.loadOverlayPatches('dsh',
  'C:/Users/35453/.dsh/profiles/desktop/cordis.patch.yml');

const rows = boot.composeEntries([bundleLayer, profileLayer]);
const flat = (Array.isArray(rows) ? rows : [rows]).flat(Infinity)
  .filter((r) => r && typeof r === 'object' && !Array.isArray(r));

console.log('composed top-level rows:', flat.length);

// 1) 重复 row id（同层）
const seen = new Map();
const dupes = [];
for (const r of flat) {
  if (typeof r.id !== 'string') continue;
  if (seen.has(r.id)) dupes.push(r.id);
  seen.set(r.id, r);
}
console.log('duplicate row ids:', dupes.length ? dupes.join(', ') : 'none');

// 2) 预设注册冲突：所有 dsh-agent-preset 行按 preset id 归组
const presets = flat.filter((r) => r.name === '@deepseek-ai/dsh-agent-preset' && r.config);
const byId = new Map();
for (const p of presets) {
  const k = p.config.id;
  byId.set(k, [...(byId.get(k) ?? []), p]);
}
console.log('\nagent-preset rows:', presets.length);
for (const [id, list] of byId) {
  const bad = list.length > 1;
  console.log(`  preset ${JSON.stringify(id)}: ${list.length} row(s)` + (bad ? '  <-- DUPLICATE, register() would throw' : '') +
    ` name=${JSON.stringify(list[0].config.name)} order=${list[0].config.order} plugins=${list[0].config.plugins?.map(x => x.id).join(',')}`);
}

// 3) 每条非 group 行都要有 name
const nameless = flat.filter((r) => typeof r.name !== 'string' || r.name === '');
console.log('\nrows without a plugin name:', nameless.length);

const ok = dupes.length === 0 && [...byId.values()].every((l) => l.length === 1) && nameless.length === 0;
console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
