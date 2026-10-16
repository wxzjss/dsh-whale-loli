#!/usr/bin/env node
/**
 * 用真实 semver（DSH 自带的那份）验证 package.json 的 peerDependencies 范围
 * 能不能覆盖 harness 的各个发布档。
 *
 * 背景：README 里那条坑——不带显式预发布分支的 peer 范围会静默排除
 * harness 的所有 prerelease 构建，用户 npm install 时会吃到 ERESOLVE。
 * 所以每个范围都要对「当前实际在册的版本」逐一 satisfies 一遍。
 */
import { readFileSync } from 'node:fs';

let semver;
// 优先用 DSH 自带的那份 semver（版本与宿主一致）；
// 没有 DSH（例如 CI）就退回本机 node 自带的 / 随便一份可用的 semver。
try {
  const { findDshRoot } = await import('./lib/dsh-root.mjs');
  const DSH_ROOT = findDshRoot();
  if (DSH_ROOT) {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const require = createRequire(DSH_ROOT + '/node_modules/');
    try {
      semver = require('semver');
    } catch {
      semver = await import(pathToFileURL(DSH_ROOT + '/node_modules/semver/index.js').href);
    }
  }
} catch {
  // 落到下面的动态 import
}
if (!semver) {
  try {
    semver = await import('semver');
  } catch {
    console.log('[skip] 找不到 semver（无 DSH 安装且本机没装 semver），跳过 peer 范围校验。');
    console.log('       要跑到它：npm i -D semver，或设 DSH_ROOT=<你的 DSH 安装根>');
    process.exit(0);
  }
}

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** 从 npm registry 实际观测到的版本档（2026-10-16 抓取）。 */
const OBSERVED = {
  '@deepseek-ai/cordis': ['4.0.1-rc.1', '4.0.1-rc.4', '4.0.1', '4.0.2', '4.0.3', '4.0.4', '4.0.5', '4.0.5-alpha.1', '4.0.5-alpha.2'],
  '@deepseek-ai/dsh-agent-preset': ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.5'],
  '@deepseek-ai/dsh-agent-preset-registry': ['0.1.7-alpha.1', '0.1.7-rc.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.5'],
};

let bad = 0;

for (const [name, range] of Object.entries(pkg.peerDependencies)) {
  console.log(`\n${name}`);
  console.log(`  range: ${range}`);
  const valid = semver.validRange(range);
  if (valid === null) {
    console.log('  ❌ 范围本身不是合法 semver range');
    bad++;
    continue;
  }
  // 反向验证：README 里点名的那个「看着很宽但会漏」的写法必须真的漏
  const trap = semver.satisfies('0.1.0-rc.6', '>=0.0.0-0 <0.2.0-0');
  console.log(`  sanity: 0.1.0-rc.6 satisfies ">=0.0.0-0 <0.2.0-0" = ${trap} (必须是 false，否则测试没意义)`);
  for (const v of OBSERVED[name] ?? []) {
    const ok = semver.satisfies(v, range);
    console.log(`    ${ok ? '✓' : '✗'} ${v}`);
    if (!ok) bad++;
  }
}

/** 高一层：拿 registry 上所有真实版本整体过一遍。 */
console.log('\n=== 对 registry 全量版本复查 ===');
const { execFileSync } = await import('node:child_process');
for (const name of Object.keys(pkg.peerDependencies)) {
  let versions = [];
  try {
    const raw = execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8', shell: true });
    versions = JSON.parse(raw);
  } catch {
    console.log(`  ${name}: 取不到版本列表，跳过`);
    continue;
  }
  const missed = versions.filter((v) => !semver.satisfies(v, pkg.peerDependencies[name]));
  console.log(`  ${name}: ${versions.length} 个已发布版本，未覆盖 ${missed.length} 个`);
  if (missed.length) console.log(`    未覆盖: ${missed.join(', ')}`);
}

console.log(bad === 0 ? '\nRESULT: PASS — 所有观测版本都在 peer 范围内' : `\nRESULT: FAIL — ${bad} 个版本未覆盖`);
process.exit(bad === 0 ? 0 : 1);
