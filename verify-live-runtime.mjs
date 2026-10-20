// Verify how the RUNNING host resolves the whale-loli preset at boot:
// does the bundle layer + profile layer produce exactly one preset row?
// 需要本机真有 DSH 与 desktop profile；没有就优雅跳过。
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireHostPackage } from './lib/dsh-root.mjs';

// 真机用 `requireHostPackage`，而不是 `requireDshRoot`：后者只要找到
// js-yaml 这种「够做结构校验」的根就返回，然后这一行去 import
// dsh-app-boot 就 ERR_MODULE_NOT_FOUND —— 明明该 skip 却整脚本崩掉。
// 只用真跑起来的宿主才有 dsh-app-boot（Desktop 版在 app.asar 里）。
const DSH = requireHostPackage('dsh-app-boot（合成校验）');
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE = process.env.DSH_PROFILE_DIR || join(DSH_HOME, 'profiles', 'desktop');

if (!existsSync(join(PROFILE, 'package.json'))) {
  console.log(`[skip] 没找到 profile：${PROFILE}（CI 里正常）。`);
  process.exit(0);
}

const boot = await import(
  pathToFileURL(`${DSH}/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js`).href
);

// 1. Which bundles are enabled, and which declare a patch file?
const manifest = JSON.parse(readFileSync(`${PROFILE}/package.json`, 'utf8'));
const bundles = manifest.dsh?.profile?.bundles ?? [];
console.log('enabled bundles:', JSON.stringify(bundles, null, 1));

// 2. Collect every bundle layer patch, in the same order the boot include applies them.
const units = [];
for (const name of bundles) {
  const dir = `${PROFILE}/node_modules/${name}`;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  } catch {
    console.log(`  [skip] ${name}: not installed`);
    continue;
  }
  const decl = pkg.dsh?.bundle;
  if (decl?.patch === undefined) {
    console.log(`  [no-patch] ${name}`);
    continue;
  }
  for (const file of boot.bundlePatchPaths(dir, decl)) {
    const patches = boot.loadOverlayPatches('dsh', file);
    if (patches) units.push(...patches);
    console.log(`  [layer] ${name} -> ${file.replace(PROFILE, '')} (${patches?.length ?? 0} top-level rows)`);
  }
}

// 3. Profile user layer.
const profilePatches = boot.loadOptionalPatches('dsh', `${PROFILE}/cordis.patch.yml`) ?? [];
console.log('profile user layer rows:', profilePatches.length);

// 4. Compose exactly as boot does.
const composed = boot.composeEntries([units, profilePatches]);
const rows = Array.isArray(composed) ? composed : (composed.entries ?? []);

// 四个预设都要逐一看：每个 id 在合成后必须恰好一行。
const { PRESETS } = await import('./src/index.js');
let failed = 0;
for (const p of PRESETS) {
  const whales = rows.filter((r) => r.id === `preset-${p.id}`);
  console.log(`\n=== preset-${p.id} rows after composition: ${whales.length} ===`);
  whales.forEach((r, i) => {
    console.log(`  [${i}] row id=${r.id}  name=${r.name}`);
    console.log(`      config.id=${r.config?.id}  config.name=${r.config?.name}  order=${r.config?.order}`);
    console.log(`      plugins=${(r.config?.plugins ?? []).map((x) => x.id).join(',')}`);
  });
  const ids = whales.map((r) => r.config?.id);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (whales.length !== 1) {
    failed++;
    console.log(`  RESULT: 该预设合成后应恰好 1 行，实际 ${whales.length} 行`);
  } else if (dup.length) {
    failed++;
    console.log(`  RESULT: DUPLICATE REGISTRATION -> ${dup[0]}`);
  }
}

const order = PRESETS.map((p) => {
  const r = rows.find((x) => x.id === `preset-${p.id}`);
  return r?.config?.order ?? null;
});
const orders = order.filter((v) => typeof v === 'number');
if (new Set(orders).size !== PRESETS.length) {
  failed++;
  console.log(`\norder 必须四个互不相同，实际 ${JSON.stringify(order)}`);
}

console.log(
  failed
    ? `\nRESULT: FAIL (${failed} 个问题)`
    : `\nRESULT: PASS (${PRESETS.length} 个预设各自单次注册，order 互不相同)`
);
process.exit(failed ? 1 : 0);
