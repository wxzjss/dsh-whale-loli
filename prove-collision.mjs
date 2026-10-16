// 证明：bundle 层 insert 的 preset 行与 profile 层 insert 的同名行会同时
// 存在于组合里 —— 两个 dsh-agent-preset 都挂载、注册同一个 preset id，
// 第二次 register() 抛 `Duplicate agent preset: ...`。
//
// 需要本机真有 DSH 与 desktop profile；没有就优雅跳过。
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireDshRoot } from './lib/dsh-root.mjs';

const DSH_ROOT = requireDshRoot('dsh-app-boot');
const boot = await import(
  pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href
);

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const profilePatch = join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml');
if (!existsSync(profilePatch)) {
  console.log(`[skip] 没找到 profile patch：${profilePatch}（CI 里正常）。`);
  process.exit(0);
}

const bundleLayer = boot.loadOverlayPatches(
  'dsh',
  fileURLToPath(new URL('./cordis.patch.yml', import.meta.url)).replace(/\\/g, '/'),
);
const profileLayer = boot.loadOverlayPatches('dsh', profilePatch.replace(/\\/g, '/'));

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
