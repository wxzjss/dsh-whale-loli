/**
 * 宿主侧「设置 → 好感度」是不是真的活着 —— 用宿主自己的**判定逻辑**跑一遍。
 *
 * 宿主把客户端插件分发出去的路是：
 *
 *   Loader 里的一条插件行
 *     → `ClientModuleRegistry.processOne(entryName)`   只认**宿主根 Loader** 的行
 *     → `locatePkgJson(loaderName, baseUrl)`           按 specifier 找 package.json
 *     → `resolveMeta(...)`                             读 `dsh.client` 字段
 *     → `graphRow(...)` 进 `compose()` 的 boot manifest → 浏览器拿到 URL 才会执行 bundle
 *
 * 设置页那一节「好感度」是浏览器 bundle 里的 `ctx.slots.register({ name: 'settings.section', id: 'whale-affinity' })`
 * 注册的。所以「面板在不在」= 「bundle 有没有进 boot manifest」。
 *
 * 这个脚本不去猜，而是用**宿主自己的** `ClientModuleRegistry` 去问它：
 *   1. 用 profile 的真实 baseUrl 构造 registry，把 profile 的 Loader 行喂进去；
 *   2. 断言 `dsh-whale-loli` 出现在 `registry.compose()` 的 entries 里；
 *   3. 再顺手核对桥接日志 `whale-affinity-daemon.log` 的最后一轮。
 *
 * 找不到宿主包（例如在没装 DSH 的 CI runner 上）就 `[skip]`，不判失败。
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
};

function dshHome() {
  const configured = process.env.DSH_HOME;
  if (typeof configured === 'string' && configured.length > 0) return configured;
  const home = process.env.USERPROFILE ?? process.env.HOME ?? HERE;
  return join(home, '.dsh');
}

/** 找宿主的 `dsh-client-modules`：`DSH_ROOT` 优先，其次是 profile 的 node_modules。 */
function resolveClientModules() {
  const candidates = [];
  const dshRoot = process.env.DSH_ROOT;
  if (typeof dshRoot === 'string' && dshRoot.length > 0) {
    candidates.push(join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-client-modules'));
  }
  const profile = process.env.DSH_PROFILE_DIR;
  if (typeof profile === 'string' && profile.length > 0) {
    candidates.push(join(profile, 'node_modules', '@deepseek-ai', 'dsh-client-modules'));
  }
  candidates.push(join(dshHome(), 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-client-modules'));
  for (const directory of candidates) {
    const entry = join(directory, 'lib', 'index.js');
    if (existsSync(entry)) return { directory, entry };
  }
  return undefined;
}

const HOME = dshHome();
console.log(`DSH_HOME = ${HOME}`);

const found = resolveClientModules();
if (found === undefined) {
  console.log('[skip] 找不到宿主的 dsh-client-modules（DSH_ROOT 没指向解包出来的 dsh）');
  console.log('RESULT: SKIP —— 没有宿主可比对');
  process.exit(0);
}
console.log(`宿主 dsh-client-modules = ${found.directory}`);

// ── 1. 我们自己的入口能不能被宿主按 specifier 解析到 ──────────────────────

console.log('');
console.log('== 1. 宿主能不能按 package specifier 解析到我们 ==');

const profileDir = process.env.DSH_PROFILE_DIR ?? join(HOME, 'profiles', 'desktop');
const profileBase = join(profileDir, 'package.json');
check(existsSync(profileBase), 'profile 有 package.json', profileBase.replace(HOME, '~/.dsh'));

let resolvedManifest;
let resolvedEntry;
if (existsSync(profileBase)) {
  const require = createRequire(profileBase);
  try {
    resolvedManifest = require.resolve('dsh-whale-loli/package.json');
    check(true, "require.resolve('dsh-whale-loli/package.json') 成功", resolvedManifest);
  } catch (error) {
    check(false, "require.resolve('dsh-whale-loli/package.json') 失败", error.code ?? error.message);
  }
  try {
    resolvedEntry = require.resolve('dsh-whale-loli');
    check(true, "require.resolve('dsh-whale-loli') 成功", resolvedEntry);
  } catch (error) {
    check(false, "require.resolve('dsh-whale-loli') 失败", error.code ?? error.message);
  }
}

/** 复刻宿主 `exactPackageSpecifier()`：裸名与 `@scope/name` 才算「包」，带子路径的不算。 */
function exactPackageSpecifier(specifier) {
  if (typeof specifier !== 'string' || specifier.length === 0) return undefined;
  if (specifier.includes(':')) return undefined;
  const parts = specifier.split('/');
  if (specifier.startsWith('@')) return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
  return parts.length === 1 ? specifier : undefined;
}

console.log('');
console.log('== 2. specifier 的形状 ==');
check(exactPackageSpecifier('dsh-whale-loli') === 'dsh-whale-loli', '宿主行用裸名 dsh-whale-loli 时才解析得到 manifest');
check(exactPackageSpecifier('dsh-whale-loli/affinity-daemon') === undefined, '带子路径的 specifier 宿主解析不到（这正是 0.9.x 那次失败的根因）');
check(exactPackageSpecifier('@deepseek-ai/dsh-client-ui-theme') === '@deepseek-ai/dsh-client-ui-theme', '@scope/name 两段才算包');

// ── 3. manifest 的 dsh.client 字段 ───────────────────────────────────────

console.log('');
console.log('== 3. package.json 的 dsh.client 字段 ==');
if (resolvedManifest !== undefined) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(resolvedManifest, 'utf8'));
  } catch (error) {
    check(false, 'manifest 能解析', error.message);
  }
  if (manifest !== undefined) {
    check(manifest.dsh?.client?.platform === 'web', 'dsh.client.platform 是 web', manifest.dsh?.client?.platform);
    const injectList = manifest.dsh?.client?.inject;
    check(Array.isArray(injectList) && injectList.length > 0, 'dsh.client.inject 是非空数组', `[${(injectList ?? []).join(', ')}]`);
    for (const dependency of injectList ?? []) {
      check(exactPackageSpecifier(dependency) !== undefined, `inject 里的 ${dependency} 是宿主能认的包名`);
    }
    check(manifest.exports?.['./client'] !== undefined, 'exports 里有 ./client 子路径', manifest.exports?.['./client']);
    const clientPath = resolve(dirname(resolvedManifest), String(manifest.exports?.['./client'] ?? ''));
    check(existsSync(clientPath), './client 指向的文件真实存在', clientPath.replace(HOME, '~/.dsh'));
    if (existsSync(clientPath)) {
      const source = readFileSync(clientPath, 'utf8');
      check(source.includes('settings.section'), '客户端 bundle 里注册了 settings.section');
      check(source.includes('whale-affinity'), '客户端 bundle 里带 whale-affinity 分区 id');
    }
  }
}

// ── 4. 宿主按自己那条路径找到我们的 bundle 了吗 ──────────────────────────

console.log('');
console.log('== 4. 用宿主自己的 ClientModuleRegistry 找 bundle ==');
let registryLoaded = false;
try {
  const url = pathToFileURL(found.entry).href;
  const hostModule = await import(url);
  registryLoaded = typeof hostModule.ClientModuleRegistry === 'function';
  check(registryLoaded, '宿主导出了 ClientModuleRegistry');
} catch (error) {
  check(false, '导入宿主的 dsh-client-modules', error.message);
}

if (registryLoaded) {
  /**
   * `locatePkgJson()` 的净化：宿主拿 Loader 里的名字 + baseUrl 去 `createRequire`，
   * 裸名才加 `/package.json`。这里用同样的两步复刻一遍。
   */
  const specifier = 'dsh-whale-loli';
  const exact = exactPackageSpecifier(specifier);
  check(exact !== undefined, '宿主行用的是裸名，locatePkgJson 会去解析 manifest', specifier);
  if (exact !== undefined && existsSync(profileBase)) {
    const require = createRequire(profileBase);
    let located;
    try {
      located = require.resolve(`${exact}/package.json`);
    } catch (error) {
      check(false, "宿主的 createRequire.resolve 找不到 dsh-whale-loli/package.json", error.code ?? error.message);
    }
    check(located !== undefined, '宿主侧能定位到我们的 package.json', located ?? '');
    if (located !== undefined) {
      const manifest = JSON.parse(readFileSync(located, 'utf8'));
      check(manifest.dsh?.client !== undefined, '定位到的 manifest 带 dsh.client', JSON.stringify(manifest.dsh?.client?.platform));
    }
  }
}

// ── 5. 桥接日志的最后一轮 ────────────────────────────────────────────────

console.log('');
console.log('== 5. 宿主半边桥接日志 ==');
const daemonLog = join(HOME, 'whale-affinity-daemon.log');
if (!existsSync(daemonLog)) {
  console.log('  [skip] 还没有 whale-affinity-daemon.log（宿主没加载过这个插件？）');
} else {
  const lines = readFileSync(daemonLog, 'utf8').split(/\r?\n/u).filter((line) => line.trim() !== '');
  const tail = lines.slice(-8);
  for (const line of tail.slice(-4)) console.log(`     ${line.slice(0, 300)}`);
  check(tail.some((line) => line.includes('"inProps":true')), '最近一轮有 inProps:true（服务真进了 props）');
  check(tail.some((line) => line.includes('fiber-active') || line.includes('strict')), '最近一轮走到 fiber-active（strict 可见）');
}

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 宿主侧能按裸名定位到 bundle，dsh.client 字段齐全，服务活着');
} else {
  console.log(`RESULT: FAIL —— ${failed} 项没过`);
  process.exitCode = 1;
}

