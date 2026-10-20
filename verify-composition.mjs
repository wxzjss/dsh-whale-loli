// 组合体检：bundle 层 + profile 层合成后，
// 断言三个预设都在、记忆行不串、没有重复 row id。
//
// 这需要本机真的有 DSH 安装与 desktop profile；CI 里没有，故优雅跳过。
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { requireHostPackage } from './lib/dsh-root.mjs';

const DSH_ROOT = requireHostPackage('dsh-app-boot');
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILE = process.env.DSH_PROFILE_DIR || join(DSH_HOME, 'profiles', 'desktop');

if (!existsSync(join(PROFILE, 'package.json'))) {
  console.log(`[skip] 没找到 profile：${PROFILE}（CI 里正常）。`);
  process.exit(0);
}

const boot = await import(
  pathToFileURL(DSH_ROOT + '/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js').href
);

const manifest = JSON.parse(readFileSync(`${PROFILE}/package.json`, 'utf8'));
const bundles = manifest.dsh?.profile?.bundles ?? [];

const units = [];
for (const name of bundles) {
  const dir = `${PROFILE}/node_modules/${name}`;
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'));
  } catch {
    continue;
  }
  const decl = pkg.dsh?.bundle;
  if (decl?.patch === undefined) continue;
  for (const file of boot.bundlePatchPaths(dir, decl)) {
    const patches = boot.loadOverlayPatches('dsh', file);
    if (patches) units.push(...patches);
  }
}

const profilePatches = boot.loadOptionalPatches('dsh', `${PROFILE}/cordis.patch.yml`) ?? [];
const composed = boot.composeEntries([units, profilePatches]);
const rows = (Array.isArray(composed) ? composed : [composed]).flat(Infinity)
  .filter((r) => r && typeof r === 'object' && !Array.isArray(r));

console.log('composed top-level rows:', rows.length);

// 重复 row id
const seen = new Map();
const dupes = [];
for (const r of rows) {
  if (typeof r.id !== 'string') continue;
  if (seen.has(r.id)) dupes.push(r.id);
  seen.set(r.id, r);
}
console.log('duplicate row ids:', dupes.length ? dupes.join(', ') : 'none');

// 预设注册冲突 + 记忆隔离
const presets = rows.filter((r) => r.name === '@deepseek-ai/dsh-agent-preset' && r.config);
const byId = new Map();
for (const p of presets) byId.set(p.config.id, [...(byId.get(p.config.id) ?? []), p]);

console.log('\nagent-preset rows:', presets.length);
const memFiles = new Set();
const memVars = new Set();
const memTools = new Set();
for (const [id, list] of byId) {
  const mem = list[0].config.plugins?.find((p) => p.id === 'whale-memory');
  const tag = mem
    ? `file=${mem.config.file} variable=${mem.config.variableName} tool=${mem.config.toolName}`
    : '(no whale-memory)';
  console.log(`  ${id}: ${list.length} row(s)  ${tag}`);
  if (mem) {
    if (memFiles.has(mem.config.file)) console.log(`    !! 记忆文件重复: ${mem.config.file}`);
    if (memVars.has(mem.config.variableName)) console.log(`    !! 变量名重复: ${mem.config.variableName}`);
    if (memTools.has(mem.config.toolName)) console.log(`    !! 写入工具名重复: ${mem.config.toolName}`);
    // complete 预设里独立 section 会被宿主丢掉 —— 配了也是死配置
    if (mem.config.sectionName !== undefined) console.log(`    !! 不应配置 sectionName: ${mem.config.sectionName}`);
    memFiles.add(mem.config.file);
    memVars.add(mem.config.variableName);
    memTools.add(mem.config.toolName);
  }
}

const EXPECTED_PRESETS = [
  '鲸鱼娘Agent预设',
  '鲸鱼娘活人版Agent预设',
  '鲸鱼娘涩涩版Agent预设',
  '鲸鱼娘女儿版Agent预设',
];
const missing = EXPECTED_PRESETS.filter((id) => !byId.has(id));
const both =
  missing.length === 0 &&
  memFiles.size === EXPECTED_PRESETS.length &&
  memVars.size === EXPECTED_PRESETS.length &&
  memTools.size === EXPECTED_PRESETS.length &&
  dupes.length === 0;

console.log('\n四个预设都在:', missing.length === 0, missing.length ? '缺少 ' + missing.join('、') : '');
console.log('记忆文件数:', memFiles.size, '|', [...memFiles].join(', '));
console.log('变量名数  :', memVars.size, '|', [...memVars].join(', '));
console.log('写入工具数:', memTools.size, '|', [...memTools].join(', '));
console.log('\nRESULT:', both ? 'PASS' : 'FAIL');
process.exit(both ? 0 : 1);
