// 回归测试：宿主到底能不能发现我们的客户端 bundle。
//
// 背景（0.9.1 的真实事故）：设置页里一直看不到「好感度」，因为宿主
// `@deepseek-ai/dsh-client-modules` 在扫客户端时只认 `ctx.loader.entries()`
// 里那些 **specifier 解析得成包** 的行：
//
//   locatePkgJson(loaderName, baseUrl):
//     const pathLike = startsWith('.') || startsWith('file:') || isAbsolute()
//     const expectedPackageName = pathLike ? undefined : exactPackageSpecifier(loaderName)
//     if (!pathLike && expectedPackageName === undefined) return undefined   // ← 静默放弃
//     createRequire(baseUrl).resolve(`${expectedPackageName}/package.json`)
//
//   exactPackageSpecifier(specifier):
//     const parts = specifier.split('/')
//     return parts.length === 2 && parts.every(Boolean) ? specifier : undefined
//
// 于是 `dsh-whale-loli/affinity-daemon` 会被当成「精确包名」去 resolve
// `dsh-whale-loli/affinity-daemon/package.json` —— 那个文件不存在
// （ERR_PACKAGE_PATH_NOT_EXPORTED），manifest 拿不到，`dsh.client` 永远不被发现，
// 面板永远不出现，而且**宿主不报任何错**。这就是它藏了三个版本的原因。
//
// 本脚本把宿主那两段判定原样复刻，直接对着 profile 的安装态跑，
// 保证「设置 → 好感度」有且只有一条能被发现的挂载路径。

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

const PKG = 'dsh-whale-loli';
const patchPath = 'cordis.patch.yml';
const patch = readFileSync(patchPath, 'utf8');

/** 宿主 `exactPackageSpecifier` 的原样复刻（L83-89）。 */
function exactPackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
  }
  return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':') ? specifier : undefined;
}

/** 宿主 `isPathLike` 的判定（locatePkgJson 第一行）。 */
function isPathLike(name) {
  return name.startsWith('.') || name.startsWith('file:') || isAbsolute(name);
}

/**
 * 宿主 `locatePkgJson` 的判定 + resolve 复刻。
 * @returns {{ok:true, manifestPath:string} | {ok:false, reason:string}}
 */
function locatePkgJson(loaderName, baseUrl) {
  const pathLike = isPathLike(loaderName);
  const expectedPackageName = pathLike ? undefined : exactPackageSpecifier(loaderName);
  if (!pathLike && expectedPackageName === undefined) {
    return { ok: false, reason: `specifier 不是精确包名（${loaderName.split('/').length} 段），宿主直接放弃` };
  }
  const specifier = pathLike ? `${loaderName}/package.json` : `${expectedPackageName}/package.json`;
  try {
    return { ok: true, manifestPath: createRequire(baseUrl).resolve(specifier) };
  } catch (e) {
    return { ok: false, reason: `resolve(${specifier}) 失败：${e.code ?? e.message}` };
  }
}

console.log('=== 1. 从 patch 里取出所有挂载本包的行 ===');
/** @type {{id:string, name:string, hasDaemonFlag:boolean, block:string}[]} */
const rows = [];
const rowRe = /-\s+id:\s*(\S+)\n(\s+)name:\s*'([^']+)'\n(\2config:\n((?:\2\s+.*\n)*))?/g;
for (const m of patch.matchAll(rowRe)) {
  const [, id, , name, , configBody] = m;
  if (name !== PKG && !name.startsWith(PKG + '/')) continue;
  rows.push({ id, name, configBody: configBody ?? '', hasDaemonFlag: /daemon:\s*true/.test(configBody ?? '') });
}
console.log('   本包挂载行:', rows.map((r) => `${r.id}(${r.name}${r.hasDaemonFlag ? ',daemon' : ''})`).join(', ') || '(none)');
check('patch 里有且仅有一个宿主级守护进程行', rows.filter((r) => r.hasDaemonFlag).length === 1);

console.log('\n=== 2. 反证：子路径 specifier 一定被宿主放弃（事故本体）===');
{
  const sub = locatePkgJson(`${PKG}/affinity-daemon`, pathToBase());
  check(
    '子路径 specifier 被判定为不可发现',
    sub.ok === false,
    sub.ok ? '竟然解到了 ' + sub.manifestPath : sub.reason,
  );
  check(
    '裸名 specifier 是精确包名（宿主认它）',
    exactPackageSpecifier(PKG) === PKG,
    String(exactPackageSpecifier(PKG)),
  );
  check(
    'scoped 包名必须 2 段（@scope/name），3 段不算',
    exactPackageSpecifier('@scope/name/sub') === undefined,
  );
  check(
    'scheme-qualified / 路径形态都不算精确包名',
    exactPackageSpecifier('cordis:group') === undefined
      && exactPackageSpecifier('./src/index.js') === undefined,
  );
}

console.log('\n=== 3. 正证：守护进程行必须真的能被宿主解析到 manifest ===');
// 这一节的前提是「本包已装进这个 profile」。CI 的干净 runner 上既没有 ~/.dsh
// 也没有装这个包，resolve 必然 MODULE_NOT_FOUND —— 那是环境缺失，不是缺陷，
// 所以跳过（第 2 节的纯判定反证仍然照跑，事故形态在任何机器上都拦得住）。
// 本地装了包就必须过，用 DSH_FORCE_CLIENT_DISCOVERY=1 可以强制要求在 CI 里也过。
const baseUrl = pathToBase();
console.log('   profile base:', baseUrl);
const daemonRows = rows.filter((r) => r.hasDaemonFlag);
let installable = true;
for (const row of daemonRows) {
  const probe = locatePkgJson(row.name, baseUrl);
  if (probe.ok) continue;
  installable = false;
  const forced = process.env.DSH_FORCE_CLIENT_DISCOVERY === '1';
  const lines = [
    '[skip] 本包没装进这个 profile，跳过「宿主能解析到 manifest」的校验。',
    `        原因：${probe.reason}`,
    `        base：${baseUrl}`,
    '        这台机器没装 dsh-whale-loli（CI runner / 未安装的开发机都是这样），属正常。',
  ];
  console.log(lines.join('\n'));
  if (forced) {
    check('强制模式下必须解析得动（DSH_FORCE_CLIENT_DISCOVERY=1）', false, probe.reason);
    process.exit(1);
  }
}
for (const row of installable ? daemonRows : []) {
  const located = locatePkgJson(row.name, baseUrl);
  check(`守护进程行 specifier「${row.name}」可被宿主解析`, located.ok, located.ok ? located.manifestPath : located.reason);
  if (!located.ok) continue;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(located.manifestPath, 'utf8'));
  } catch (e) {
    check('manifest 可读', false, e.message);
    continue;
  }
  check('manifest.name 就是本包', manifest.name === PKG, String(manifest.name));

  // 宿主 parseDshClient 的校验：platform 必须 string、inject/external 必须 string[]
  const client = manifest.dsh?.client;
  check('declares dsh.client', client !== undefined && typeof client === 'object');
  check('dsh.client.platform 是字符串', typeof client?.platform === 'string', String(client?.platform));
  const injectList = client?.inject;
  check(
    'dsh.client.inject 是字符串数组',
    injectList === undefined || (Array.isArray(injectList) && injectList.every((x) => typeof x === 'string')),
    JSON.stringify(injectList),
  );

  // 宿主 clientExportOf：exports['./client'] 必须是字符串，或 { default: string }
  const exp = manifest.exports?.['./client'];
  const clientFile = typeof exp === 'string' ? exp : typeof exp?.default === 'string' ? exp.default : undefined;
  check("exports['./client'] 解析成一个字符串", clientFile !== undefined, JSON.stringify(exp));

  // files 必须把 lib 打进去，否则发布出去的 tarball 里没有客户端文件
  check('files 含 lib（客户端文件会被发布）', Array.isArray(manifest.files) && manifest.files.includes('lib'));

  // manifest 声明的 client 文件必须真在磁盘上（Junction 安装态下也要能读到）
  if (clientFile !== undefined) {
    const disk = resolve(located.manifestPath, '..', clientFile);
    check(`客户端文件存在：${clientFile}`, existsSync(disk));
    if (existsSync(disk)) {
      const src = readFileSync(disk, 'utf8');
      // 宿主用 <script src> 加载，所以不能是 ESM、不能有 JSX
      check('客户端是经典脚本（无 import/export）', !/^\s*(?:import|export)\s/m.test(src));
      check('客户端注册到 __ModuleLoader__', src.includes('__ModuleLoader__'));
      check('客户端注入 settings.section 槽位', src.includes('settings.section'));
    }
  }
}

console.log('\n=== 4. 预设里的行不会污染客户端扫描（它们不在根 Loader entries）===');
check(
  '预设内的行必须是裸名（与守护进程行同一 specifier）',
  rows.every((r) => r.name === PKG),
  rows.map((r) => r.name).join(', '),
);
// 预设里 8 行 + 宿主级 1 行，全都解析到同一个 manifest；
// 宿主对同一 packageName 的多个 source 会判冲突，但它们不在同一 baseUrl/scope，
// 且只有宿主根那一条会进 ctx.loader.entries()，所以不会触发 reconcilePackage 报错。
check('只有宿主级那一条会进入客户端扫描', rows.filter((r) => r.hasDaemonFlag).length === 1);

console.log('\nRESULT:', ok ? 'PASS —— 宿主能发现客户端 bundle，「设置 → 好感度」有挂载路径' : 'FAIL');
process.exit(ok ? 0 : 1);

/** profile 目录的 package.json URL —— 宿主 resolveSource 用的就是这个 base。 */
function pathToBase() {
  const profile = process.env.DSH_PROFILE_DIR
    || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'desktop');
  return new URL(`file:///${resolve(profile, 'package.json').replace(/\\/g, '/')}`).href;
}
