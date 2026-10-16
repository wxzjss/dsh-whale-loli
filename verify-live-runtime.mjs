// Verify how the RUNNING host resolves the whale-loli preset at boot:
// does the bundle layer + profile layer produce exactly one preset row?
// 需要本机真有 DSH 与 desktop profile；没有就优雅跳过。
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireDshRoot } from './lib/dsh-root.mjs';

const DSH = requireDshRoot('dsh-app-boot');
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

const whales = rows.filter((r) => r.id === 'preset-鲸鱼娘Agent预设');
console.log('\n=== preset-鲸鱼娘Agent预设 rows after composition:', whales.length, '===');
whales.forEach((r, i) => {
  console.log(`  [${i}] row id=${r.id}  name=${r.name}`);
  console.log(`      config.id=${r.config?.id}  config.name=${r.config?.name}`);
  console.log(`      plugins=${(r.config?.plugins ?? []).map((p) => p.id).join(',')}`);
});

const ids = whales.map((r) => r.config?.id);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log(
  dup.length
    ? `RESULT: DUPLICATE REGISTRATION -> ${dup[0]}`
    : 'RESULT: PASS (single registration)'
);
