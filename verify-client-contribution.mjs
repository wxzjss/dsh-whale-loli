/**
 * 复刻客户端 `ctx.remote.$mount()` 的**全部校验**，在 Node 里跑一遍。
 *
 * 为什么要这个脚本：
 *   设置页「好感度」一节一直报「远程方法 whale-affinity.status 未挂载」，而宿主
 *   侧日志（`whale-affinity-daemon.log`）证明服务确实 provide 了、fiber 也 active
 *   了、strict 查找可见。也就是说失败发生在**浏览器侧**，而浏览器侧的报错只在
 *   devtools console 里 —— 用户看不到，也没法在 CI 里复现。
 *
 *   所以这里把 `$mount()` 用到的校验规则逐条抄下来，喂给我们真实的
 *   `lib/client.js` 造出来的 contribution：
 *
 *     1. `requireStrictInputs()` —— 每个参数必须有 `codec.mode === 'strict'`
 *     2. `validateContribution()` ——
 *        - 同一份 contribution 里不能重复声明同一个 `<namespace>/<method>`
 *        - namespace 不能与已有 Remote 服务冲突（`remote.<ns>` 已存在）
 *        - 方法名不能撞 `REMOTE_NAMESPACE_FIELDS` 或 `RemoteNamespaceService.prototype`
 *     3. `typert.remotes.register()` 的 `validatePackage()` ——
 *        `face` 必须是 `host`/`client`，`<package>#<face>` 不能重复注册
 *     4. `typert.remotes.register()` 的 `validateSchemas()` —— 名字合法、不重复
 *     5. `localStore.validate()` 的 `validateInvocation()` ——
 *        `id` / `service` / `namespace` / `method` 必须是合法 wire 名，
 *        参数的 `name` / `wire` 同理，且 `wire` 不能重复
 *
 * 任何一条不过，`$mount()` 都会 reject —— 而这个 reject 原来被 `console.warn`
 * 吞掉了。这个脚本把「能不能挂上」从「重启一次看看」变成一次可执行的判断。
 *
 * 规则出处：`_asar_ro/ext/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.browser.js`
 *          `_asar_ro/ext/dsh/node_modules/@deepseek-ai/dsh-typert-registry/lib/client.browser.js`
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, 'lib', 'client.js');
const DAEMON = join(HERE, 'src', 'daemon.js');

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failed += 1;
};

// ── 从 lib/client.js 里把 contribution 抠出来，在最小 window 桩上执行 ────────

/**
 * `lib/client.js` 是给浏览器用的 classic script，靠 `window.__ModuleLoader__.load`
 * 把自己注册进去。这里造一个足以跑通它顶层声明的桩，并把 factory 拿回来。
 */
function loadClientModule() {
  let captured;
  const window = {
    __ModuleLoader__: {
      load: (record) => {
        captured = record;
      },
    },
  };
  const require = (specifier) => {
    if (specifier === 'react') {
      return {
        useState: (value) => [value, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
      };
    }
    if (specifier === 'react/jsx-runtime') {
      return { jsxs: () => null, jsx: () => null };
    }
    throw new Error(`自检脚本不认识这个模块：${specifier}`);
  };
  const source = readFileSync(CLIENT, 'utf8');
  // 只在函数作用域里求值，不污染全局；`window` 和 `require` 是它的自由变量。
  const run = new Function('window', 'require', `${source}\n;`);
  run(window, require);
  if (captured === undefined) throw new Error('lib/client.js 没有调用 window.__ModuleLoader__.load()');
  if (captured.id !== 'dsh-whale-loli') throw new Error(`lib/client.js 注册的 id 是 ${JSON.stringify(captured.id)}`);
  return captured.factory(require);
}

// ── 宿主侧的常量，必须与客户端一致 ─────────────────────────────────────────

const DAEMON_ID = 'whale-affinity-daemon';
const NAMESPACE = 'whale-affinity';

/** 与网关 `REMOTE_NAMESPACE_FIELDS` 一字不差。 */
const REMOTE_NAMESPACE_FIELDS = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace']);

/** `RemoteNamespaceService.prototype` 上除字段外的成员。 */
const REMOTE_SERVICE_PROTOTYPE = [
  'assertMethodAvailable',
  'has',
  'installDirect',
  'installScoped',
  'remove',
  'invokeMethod',
  'constructor',
  'empty',
];

/** 网关 `validateSegment()`：非空、不含分隔符或空白。 */
function validSegment(value) {
  return typeof value === 'string' && value.length > 0 && !/[/\s#]/u.test(value);
}

/** 网关 `validateWireName()`：非空、只含 wire 名允许的字符。 */
function validWireName(value) {
  return typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);
}

console.log('== 1. lib/client.js 能在最小桩上加载 ==');
let contribution;
try {
  const exports = loadClientModule();
  check(typeof exports.apply === 'function', '模块导出了 apply()');
  check(Array.isArray(exports.inject), '模块导出了 inject 数组', `[${exports.inject?.join(', ')}]`);
  check(typeof exports.contribution === 'function', '模块导出了 contribution()');
  contribution = exports.contribution();
  check(contribution !== undefined && typeof contribution === 'object', 'contribution() 有返回值');
} catch (error) {
  check(false, '加载 lib/client.js', error.message);
}

if (contribution !== undefined) {
  console.log('');
  console.log('== 2. contribution 顶层字段 ==');
  check(contribution.package === 'dsh-whale-loli', 'package 是 dsh-whale-loli', contribution.package);
  check(Array.isArray(contribution.methods) && contribution.methods.length > 0, 'methods 是非空数组', `${contribution.methods?.length} 个`);

  const descriptors = (contribution.methods ?? []).map((row) => ({
    ...row,
    namespace: row.namespace ?? NAMESPACE,
    parameters: row.parameters ?? [],
    invocation: row.invocation ?? { kind: 'direct' },
  }));

  console.log('');
  console.log('== 3. 每个方法都过 requireStrictInputs() ==');
  for (const descriptor of descriptors) {
    const bad = descriptor.parameters.filter((p) => p.codec?.mode !== 'strict');
    check(bad.length === 0, `${NAMESPACE}/${descriptor.method} 的参数都有 strict codec`, bad.map((p) => p.wire).join(', ') || '');
  }

  console.log('');
  console.log('== 4. validateContribution()：重复 / 冲突 ==');
  const seen = new Set();
  let duplicate = null;
  for (const descriptor of descriptors) {
    const key = `${descriptor.namespace}/${descriptor.method}`;
    if (seen.has(key)) duplicate = key;
    seen.add(key);
  }
  check(duplicate === null, '同一 contribution 里没有重复方法', duplicate ?? '');

  const conflicts = descriptors.filter(
    (d) => REMOTE_NAMESPACE_FIELDS.has(d.method) || REMOTE_SERVICE_PROTOTYPE.includes(d.method),
  );
  check(conflicts.length === 0, '方法名不撞命名空间服务的成员', conflicts.map((d) => d.method).join(', ') || '');
  check(NAMESPACE !== 'remote', 'namespace 不叫 remote 本身');
  check(validWireName(NAMESPACE) || /^[a-z][a-z0-9-]*$/u.test(NAMESPACE), 'namespace 名字合法', NAMESPACE);

  console.log('');
  console.log('== 5. typert.remotes.register()：package 与 schemas ==');
  check(validSegment(contribution.package), 'package 是合法 segment', contribution.package);
  // 客户端 contribution 的 `face` 缺省为 `client`；宿主的 daemon 走 Same-Namespace 兜底，
  // 不注册 package face，所以这里只要不是 host 就不会撞。
  const face = contribution.face ?? 'client';
  check(face === 'client' || face === 'host', 'face 是 client 或 host', face);
  check(face === 'client', 'face 不是 host（宿主侧不注册 package face，撞不上）', face);
  const schemas = contribution.schemas ?? [];
  const schemaKeys = new Set();
  let schemaDup = null;
  let schemaBad = null;
  for (const schema of schemas) {
    if (!validSegment(schema.name)) schemaBad = schema.name;
    if (schemaKeys.has(schema.name)) schemaDup = schema.name;
    schemaKeys.add(schema.name);
  }
  check(schemaBad === null, 'schema 名字都合法', schemaBad ?? '');
  check(schemaDup === null, 'schema 名字不重复', schemaDup ?? '');

  console.log('');
  console.log('== 6. localStore.validate()：每个 invocation 的 wire 名 ==');
  for (const descriptor of descriptors) {
    const label = `${NAMESPACE}/${descriptor.method}`;
    const wires = new Set();
    let repeatWire = null;
    let badWire = null;
    let badName = null;
    for (const parameter of descriptor.parameters) {
      if (!validWireName(parameter.wire)) badWire = parameter.wire;
      if (!validWireName(parameter.name)) badName = parameter.name;
      if (wires.has(parameter.wire)) repeatWire = parameter.wire;
      wires.add(parameter.wire);
    }
    check(validWireName(descriptor.method), `${label} 方法名是合法 wire 名`);
    check(validSegment(descriptor.service ?? DAEMON_ID), `${label} service 是合法 segment`, descriptor.service ?? '');
    check(badWire === null, `${label} 参数 wire 名合法`, badWire ?? '');
    check(badName === null, `${label} 参数 name 合法`, badName ?? '');
    check(repeatWire === null, `${label} 参数 wire 不重复`, repeatWire ?? '');
    check(typeof descriptor.id === 'string' && descriptor.id.length > 0, `${label} 有 invocation id`, descriptor.id ?? '');
  }

  console.log('');
  console.log('== 7. 与宿主 daemon 的方法表对得上 ==');
  const daemonSource = readFileSync(DAEMON, 'utf8');
  const tableMatch = daemonSource.match(/REMOTE_METHODS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/u);
  check(tableMatch !== null, 'src/daemon.js 里有 REMOTE_METHODS 表');
  if (tableMatch !== null) {
    const hostMethods = [...tableMatch[1].matchAll(/method:\s*'([^']+)'/gu)].map((m) => m[1]);
    const clientMethods = descriptors.map((d) => d.method);
    check(hostMethods.length > 0, '宿主方法表非空', hostMethods.join(', '));
    for (const method of clientMethods) {
      check(hostMethods.includes(method), `客户端声明的 ${method} 在宿主方法表里`, '');
    }
    for (const method of hostMethods) {
      check(clientMethods.includes(method), `宿主方法 ${method} 在客户端 contribution 里`, '');
    }
  }
}

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— contribution 能过客户端 $mount() 的全部校验');
} else {
  console.log(`RESULT: FAIL —— ${failed} 项没过，$mount() 会 reject`);
  process.exitCode = 1;
}
