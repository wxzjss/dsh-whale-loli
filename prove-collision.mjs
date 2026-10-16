// 证明：bundle 层 insert 的 preset-whale-loli 与 profile 层 insert 的
// 同名行会同时存在于组合里 —— 两个 dsh-agent-preset 都挂载、注册同一个
// preset id，第二次 register() 抛 `Duplicate agent preset: whale-loli`。
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
const flat = Array.isArray(rows) ? rows.flat(Infinity) : [rows];
const withId = flat.filter((r) => r && typeof r === 'object' && r.id === 'preset-鲸鱼娘Agent预设');

console.log('preset-鲸鱼娘Agent预设 rows in composed output:', withId.length);
for (const [i, r] of withId.entries()) {
  console.log(`  [${i}] name=${r.name} presetId=${r.config?.id} hasName=${r.config?.name !== undefined} plugins=${r.config?.plugins?.map(p => p.id).join(',')}`);
}
if (withId.length > 1) {
  console.log('\n>>> COLLISION: both rows mount a dsh-agent-preset registering preset id ' +
    JSON.stringify(withId[0].config.id) + '.');
  console.log('>>> Second register() throws: Duplicate agent preset: ' + withId[0].config.id);
}
