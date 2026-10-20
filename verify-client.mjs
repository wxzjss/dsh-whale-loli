/**
 * 校验浏览器半边 `lib/client.js`。
 *
 * 它是给 `window.__ModuleLoader__` 用的、`require()` 走浏览器注入表的模块，
 * Node 里既没有那个 loader 也没有 react，所以这里**用真模块 + 假的 loader**
 * 把它整套跑一遍：
 *
 *   - 造一个 `window.__ModuleLoader__.load()` 接住 factory，喂一个假的 `require`
 *     （react 用桩替身：`jsx` 只把 type/props/children 记成普通对象）；
 *   - 造一个假 `ctx`（`effect` 立刻执行并记住 dispose、`slots` / `remote` 都是桩），
 *     跑 `apply()`；
 *   - 断言分区真的注册进 `settings.section`、`$mount()` 收到的方法表与宿主
 *     `src/daemon.js` 的 `REMOTE_METHODS` **逐字段对得上**（parameter 的 `wire`
 *     必须是宿主方法源码里的参数名，否则宿主会报 `gateway/arguments-invalid`）；
 *   - 把面板组件真的渲染一次（用桩 react 的 hooks 状态机），确认读通道能出值、
 *     写通道真的调了 `set`。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(here, 'lib', 'client.js');
const DAEMON = join(here, 'src', 'daemon.js');

let failed = 0;
const problems = [];

function check(label, ok, detail) {
  if (ok) {
    console.log(`✓ ${label}`);
    return;
  }
  failed += 1;
  problems.push(detail === undefined ? label : `${label} —— ${detail}`);
  console.log(`✗ ${label}${detail === undefined ? '' : ` —— ${detail}`}`);
}

// ── 1. 假 react ─────────────────────────────────────────────────────────
//
// 只实现 client.js 用到的四个：useState / useEffect / useCallback / jsx。
// 关键点：hooks 必须按**调用顺序**记录下来，这样重新渲染时能把上一次的
// state 还回去 —— 面板组件里 `useStyleOnce()` → 4 个 useState → useCallback
// → useEffect 的顺序是固定的，按序号取就够了。

function createReact() {
  const slots = [];
  let cursor = 0;
  const pending = [];

  function reset() {
    cursor = 0;
  }

  /**
   * 整体卸载：清掉所有 hook 槽位和待重渲染队列。
   *
   * 换一个面板实例（比如从「有数据」切到「空数据」）时，真 react 会重新挂载
   * 、state 全新；这里必须清槽位，否则 useState 会沿用上一轮的值，
   * 断言就会拿旧数据去比。
   */
  function hardReset() {
    slots.length = 0;
    pending.length = 0;
    cursor = 0;
  }

  function useState(initial) {
    const index = cursor;
    cursor += 1;
    if (slots[index] === undefined) {
      slots[index] = { value: typeof initial === 'function' ? initial() : initial };
    }
    const slot = slots[index];
    const set = (next) => {
      slot.value = typeof next === 'function' ? next(slot.value) : next;
      // 真 react 会重渲染；这里把「有新状态了」记到队列里，由 settle() 消费。
      pending.push(index);
    };
    return [slot.value, set];
  }

  function useCallback(fn, deps) {
    const index = cursor;
    cursor += 1;
    const previous = slots[index];
    const same = previous !== undefined
      && Array.isArray(previous.deps)
      && Array.isArray(deps)
      && previous.deps.length === deps.length
      && previous.deps.every((item, i) => Object.is(item, deps[i]));
    if (previous === undefined || !same) {
      slots[index] = { deps, fn };
    }
    return slots[index].fn;
  }

  function useEffect(fn, deps) {
    const index = cursor;
    cursor += 1;
    const previous = slots[index];
    const same = previous !== undefined
      && Array.isArray(previous.deps)
      && Array.isArray(deps)
      && previous.deps.length === deps.length
      && previous.deps.every((item, i) => Object.is(item, deps[i]));
    if (previous === undefined || !same) {
      slots[index] = { deps, cleanup: fn() };
    }
  }

  function node(type, props) {
    return { type, props };
  }

  function jsx(type, props) {
    return node(type, props ?? {});
  }

  function jsxs(type, props) {
    return node(type, props ?? {});
  }

  return {
    React: { useState, useEffect, useCallback, createElement: jsx },
    jsxRuntime: { jsx, jsxs, Fragment: Symbol('Fragment') },
    /** 每次渲染前调用，重置 hook 游标。 */
    reset,
    hardReset,
    /** 跑完一次渲染后收集 cleanup。 */
    cleanups: () => slots.filter((slot) => slot !== undefined && 'cleanup' in slot).map((slot) => slot.cleanup),
    /** 有没有因为 setState 而「需要重渲染」。 */
    hasPending: () => pending.length > 0,
    takePending: () => pending.splice(0, pending.length),
  };
}

/**
 * 模拟 react：渲染 → 跑 effect → 微任务落定 → 有 setState 就重渲染，直到稳定。
 *
 * 手写桩没有调度器，异步 `status()` 回来后那次 setState 不会自己触发重渲染，
 * 所以这里显式循环。上限防止死循环（真 react 里无限 setState 也是 bug）。
 */
async function settle(component, props, label) {
  let tree = null;
  for (let round = 0; round < 20; round += 1) {
    react.reset();
    react.takePending();
    tree = component(props);
    // 让 effect 里发起的 promise 落定
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!react.hasPending()) return tree;
  }
  throw new Error(`${label}: 面板在 20 轮渲染后仍在更新，可能死循环`);
}

/** 把渲染树摊平成一个数组，方便断言。 */
function walk(value, out = []) {
  if (value === null || value === undefined || typeof value !== 'object') {
    if (typeof value === 'string' || typeof value === 'number') out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, out);
    return out;
  }
  if (value.props !== undefined) {
    if (value.props.children !== undefined) walk(value.props.children, out);
    return out;
  }
  return out;
}

/** 收集渲染树里所有 className 含指定串的节点。 */
function findAll(value, predicate, out = []) {
  if (value === null || value === undefined || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) findAll(item, predicate, out);
    return out;
  }
  if (value.props !== undefined) {
    if (predicate(value)) out.push(value);
    for (const item of walk(value, []).length > 0 ? [] : []) void item;
    if (value.props.children !== undefined) findAll(value.props.children, predicate, out);
  }
  return out;
}

const react = createReact();

/** 假 `require`：只认 client.js 用到的三样。 */
function fakeRequire(id) {
  if (id === 'react') return react.React;
  if (id === 'react/jsx-runtime') return react.jsxRuntime;
  throw new Error(`client.js 引用了未在宿主白名单里的模块：${id}`);
}

// ── 2. 假 loader + 假 ctx，跑 apply() ───────────────────────────────────

const registered = [];
let contribution = null;
let mountedRemote = null;

const loaderId = [];
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaderId.push(spec.id);
      // 官方 factory 是同步调用、把导出挂到 module.exports 上
      const exports = spec.factory(fakeRequire);
      globalThis.__whaleClient = exports;
    },
  },
};
// 假 document：client.js 的 useStyleOnce 会往里塞 <style>
const styleTags = [];
globalThis.document = {
  head: { appendChild: (tag) => styleTags.push(tag) },
  getElementById: (id) => styleTags.find((tag) => tag.id === id) ?? null,
  createElement: (tag) => ({ tag, id: '', textContent: '' }),
};

// client.js 是纯 JS 脚本（非 ESM），用 import() 跑一次即可执行 loader
await import(pathToFileURL(CLIENT).href);

const client = globalThis.__whaleClient;
check('client.js 通过 __ModuleLoader__.load 加载', loaderId.length === 1, `id=${loaderId.join(',')}`);
check('id 与包名一致', loaderId[0] === 'dsh-whale-loli', loaderId[0]);
check('导出 apply / inject / AffinitySection', typeof client?.apply === 'function'
  && Array.isArray(client.inject)
  && typeof client.AffinitySection === 'function');

const effects = [];

/** 子上下文：只暴露自己 inject 过的服务（复刻 cordis 的 store 解析）。 */
function childOf(table, deps) {
  return {
    ...Object.fromEntries(deps.map((dep) => [dep, table[dep]])),
    effect(fn) {
      const dispose = fn();
      return () => dispose?.();
    },
  };
}

/**
 * 造一个假 ctx。
 *
 * 关键：`$mount()` 之后服务才出现在 `table` 里，`inject()` 记下等待者、等它
 * 出现再用**子上下文**回调 —— 复刻 cordis 的动态 inject。服务名是
 * `remote.whale-affinity`，在父上下文里直接取会抛
 * `cannot get property "remote.whale-affinity" without inject`。
 *
 * @param sink - 收集 `slots.register` 的数组。
 * @param stubs - 指定某些方法返回真实数据；没指定的按描述符生成通用桩。
 */
function makeCtx(sink, stubs = null) {
  const waiters = [];
  const table = {};
  const flush = () => {
    for (const waiter of waiters.splice(0)) {
      if (waiter.deps.every((dep) => dep in table)) waiter.callback(childOf(table, waiter.deps));
      else waiters.push(waiter);
    }
  };
  const ctx = {
    effect(fn, label) {
      const dispose = fn();
      effects.push({ label, dispose });
      return () => {};
    },
    inject(deps, callback) {
      waiters.push({ deps, callback });
      flush();
      return () => {};
    },
    slots: {
      inject(name, fn) {
        const value = fn();
        return () => value?.();
      },
      register(options, component) {
        sink.push({ options, component });
        return () => {};
      },
    },
    remote: {
      async $mount(spec) {
        contribution = spec;
        const methods = {};
        for (const descriptor of spec.descriptors) {
          methods[descriptor.method] = async (...args) => ({ ok: true, value: { method: descriptor.method, args } });
        }
        table[`remote.${spec.descriptors[0].namespace}`] = stubs ?? methods;
        flush();
        return () => {};
      },
    },
    connection: { state: 'online' },
  };
  return { ctx, table };
}

const { ctx, table } = makeCtx(registered);
client.apply(ctx);

// $mount 是异步的，等一轮微任务
await new Promise((resolve) => setTimeout(resolve, 0));

check('注册了 settings.section', registered.length === 1, `实际 ${registered.length} 个`);
const section = registered[0]?.options ?? {};
check('分区 id 是 whale-affinity', section.id === 'whale-affinity', String(section.id));
check('分区 label 是「好感度」', typeof section.label === 'function' && section.label() === '好感度');
check('分区 order 排在 agent-presets(20) 之后', section.order > 20, String(section.order));
check('分区没有声明 children（不调 renderSlot）', section.children === undefined);
check('分区不再注入 remote（服务名只有挂完才存在，必须动态 inject）', section.inject === undefined);
check('命名空间句柄已经通过动态 inject 拿到', table['remote.whale-affinity'] !== undefined);

// ── 3. $mount 的方法表必须与宿主 REMOTE_METHODS 逐字段对上 ──────────────

const daemonModule = await import(pathToFileURL(DAEMON).href);
const hostMethods = daemonModule.REMOTE_METHODS.map((row) => row.method);
// 宿主 $mount() 只读 `contribution.descriptors`。
const clientMethods = (contribution?.descriptors ?? []).map((row) => row.method);
check(
  '客户端方法表 = 宿主 REMOTE_METHODS',
  JSON.stringify(clientMethods) === JSON.stringify(hostMethods),
  `客户端 ${clientMethods.join(',')} / 宿主 ${hostMethods.join(',')}`,
);
check('contribution.package 与宿主一致', contribution?.package === daemonModule.REMOTE_PACKAGE, String(contribution?.package));
check('命名空间一致', daemonModule.REMOTE_NAMESPACE === client.NAMESPACE, `${daemonModule.REMOTE_NAMESPACE} / ${client.NAMESPACE}`);

// 每个方法的 wire 名必须等于宿主方法源码里的参数名
const daemon = new daemonModule.AffinityDaemon({});
const verify = daemon.verify();
let wireMismatch = [];
for (const entry of contribution?.methods ?? []) {
  const hostRow = verify.methods.find((row) => row.method === entry.method);
  const clientWires = entry.parameters.map((parameter) => parameter.wire);
  if (hostRow === undefined || JSON.stringify(hostRow.names) !== JSON.stringify(clientWires)) {
    wireMismatch.push(`${entry.method}: 客户端[${clientWires.join(',')}] 宿主[${(hostRow?.names ?? []).join(',')}]`);
  }
}
check('每个方法的 wire 名 = 宿主源码参数名', wireMismatch.length === 0, wireMismatch.join('；'));
check('宿主方法签名全部合法（verify.ok）', verify.ok === true);
check('每个参数都带 strict codec（过客户端浅校验）', (contribution?.methods ?? []).every(
  (entry) => entry.parameters.every((parameter) => parameter.codec?.mode === 'strict'),
));
check('result 走 src-json（宿主 encodeRuntimeResult）', (contribution?.methods ?? []).every(
  (entry) => entry.result?.mode === 'src-json',
));

// ── 4. 渲染面板：读通道出值、写通道真的调 set ───────────────────────────

/** 让 $mount 装出来的桩方法返回真实形状的数据。 */
const realStatus = {
  presets: [{ scope: 'whale-loli', value: 42, band: '亲密 · 偏爱', updatedAt: '2026-10-20T00:00:00Z', file: 'whale-loli-abc.json' }],
  bands: daemonModule.bandCatalog(),
  min: daemonModule.MIN_AFFINITY,
  max: daemonModule.MAX_AFFINITY,
  defaultValue: daemonModule.DEFAULT_AFFINITY,
  dir: 'C:\\Users\\x\\.dsh\\affinity',
  wired: [{ presetId: 'whale-loli', file: 'w.json', affinity: true, memory: true }],
};
const setCalls = [];
const panelSink = [];
const panel = makeCtx(panelSink, {
  status: async () => ({ ok: true, value: realStatus }),
  set: async (scope, value) => {
    setCalls.push([scope, value]);
    return { ok: true, value: { scope, value } };
  },
  verify: async () => ({ ok: true, value: verify }),
});
client.apply(panel.ctx);
await new Promise((resolve) => setTimeout(resolve, 0));

react.hardReset();
const tree = await settle(panelSink[0].component, {}, '主面板');

const text = walk(tree).join(' | ');
check('面板渲染出分区标题「好感度」', text.includes('好感度'));
check('面板显示预设名', text.includes('whale-loli'), text.slice(0, 200));
check('面板显示当前值 42', text.includes('42'), text.slice(0, 200));
check('面板显示档位名', text.includes('亲密 · 偏爱'), text.slice(0, 300));
check('面板给每个档都画了按钮', findAll(tree, (node) => node.props.className === 'whaleAffinity__band').length === 7);
check('面板画了滑块', findAll(tree, (node) => node.props.className === 'whaleAffinity__range').length === 1);

// 点第二档按钮 → 应触发 set(scope, 该档 min)
const bandButtons = findAll(tree, (node) => node.props.className === 'whaleAffinity__band');
const target = realStatus.bands[1];
const minOfTarget = bandButtons.find((node) => walk(node.props.children).join('') === target.label);
check('找得到目标档位按钮', minOfTarget !== undefined, target.label);
if (minOfTarget !== undefined) {
  minOfTarget.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check('点档位调用 set(scope, 档位下端)', setCalls.length === 1 && setCalls[0][0] === 'whale-loli' && setCalls[0][1] === target.min, JSON.stringify(setCalls));
}

// 空数据：没有预设挂上好感度时给出人话提示
const emptySink = [];
const emptyCtx = makeCtx(emptySink, { status: async () => ({ ok: true, value: { ...realStatus, presets: [], wired: [] } }) });
client.apply(emptyCtx.ctx);
await new Promise((resolve) => setTimeout(resolve, 0));
react.hardReset();
const emptyTree = await settle(emptySink[0].component, {}, '空数据面板');
check('没有预设时给出提示', walk(emptyTree).join(' ').includes('还没有哪个预设挂上好感度'));

// 错误分支：status 抛错时要显示原因，而不是白屏
const brokenSink = [];
const brokenCtx = makeCtx(brokenSink, { status: async () => ({ ok: false, error: { message: '宿主没起来' } }) });
client.apply(brokenCtx.ctx);
await new Promise((resolve) => setTimeout(resolve, 0));
react.hardReset();
const brokenTree = await settle(brokenSink[0].component, {}, '错误面板');
check('远程失败时显示原因', walk(brokenTree).join(' ').includes('宿主没起来'), walk(brokenTree).join(' ').slice(0, 200));

// ── 5. 源码级检查 ──────────────────────────────────────────────────────

const source = readFileSync(CLIENT, 'utf8');
for (const name of ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-border-l2', '--dsw-alias-interactive-bg-hover', '--dsw-alias-state-error-primary']) {
  check(`用了真实存在的主题变量 ${name}`, source.includes(name));
}
check('没有编造 --dsw-alias-danger', !source.includes('--dsw-alias-danger'));
check('只 require 白名单模块', ['react', 'react/jsx-runtime'].every((id) => source.includes(`require('${id}')`)));
check('没有 renderSlot 调用（没声明 children 就不能调）', !source.includes('renderSlot'));
// 浏览器里没有 JSX 转译，源码里出现裸 JSX 会在加载时直接语法错误。
// 注释行要跳过 —— `Promise<dispose>` 这种泛型注释会误报。
const bareJsx = source
  .split('\n')
  .map((line, index) => ({ line, index }))
  .filter(({ line }) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;
    return /<[A-Za-z][A-Za-z0-9]*[\s/>]/u.test(line);
  })
  .map(({ line, index }) => `${index + 1}: ${line.trim()}`);
check('没有裸 JSX（浏览器里没有转译）', bareJsx.length === 0, bareJsx.slice(0, 3).join(' / '));

// 宿主 `defaultLoadBundle` 用的是 `document.createElement("script")` —— **没有
// `type="module"`**，所以这份文件必须能被当成经典脚本解析：不能有 import/export，
// JSX 也不能留。用 vm.Script 真解析一遍，语法问题在这里就炸出来。
{
  const vm = await import('node:vm');
  let parseError = null;
  try {
    new vm.Script(source, { filename: 'lib/client.js' });
  } catch (cause) {
    parseError = cause;
  }
  check('能被当成经典脚本解析（无 import/export/JSX）', parseError === null, parseError?.message);
  const esm = source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
    .filter(({ line }) => /^(import|export)\s/u.test(line));
  check('没有 ESM 语句', esm.length === 0, esm.slice(0, 3).map((row) => `${row.index + 1}: ${row.line}`).join(' / '));
}

console.log('');
if (failed > 0) {
  console.log(`RESULT: FAIL —— ${failed} 项不通过`);
  for (const problem of problems) console.log(`  · ${problem}`);
  process.exit(1);
}
console.log('RESULT: PASS —— 浏览器半边全部检查通过');
