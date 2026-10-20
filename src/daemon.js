/**
 * whale-affinity-daemon —— 好感度设置页的**宿主半边**。
 *
 * 为什么需要它：
 *   设置页是浏览器里的 React 组件，拿不到 `~/.dsh/affinity/*.json`；宿主也没有
 *   任何一个内置 Remote 命名空间能读写这个文件（settings / account / llm /
 *   session / commands / goals / schedule / skills / pluginManager / workspace …
 *   全查过，都不行）。所以要由宿主这边起一个极小服务，把读写包成远程方法，
 *   浏览器半边用 `ctx.remote.$mount()` 挂上去就能调。
 *
 * 为什么伪造 typert 元数据而不是走 `ctx.typert.register()`：
 *   strict 契约要 zod 工厂 + 手写 jsonSchema + 每个参数再来一份 `strictCodec`；
 *   而客户端 `$mount` 对 strict 只做「字段是否存在」的浅校验，真正的参数编码
 *   走 `connection.rpc.call('/api', endpoint, {args}, signal)`，结果解码只在
 *   `result.decode` 存在时才做。所以 strict 纯属自找麻烦。
 *
 *   宿主网关自带 SRC 兜底：`resolveDescriptor()` 找不到 strict 定义时会调
 *   `resolveSrcDescriptor()` —— 遍历 `ctx.reflect.props` 里 `type === 'service'`
 *   的项，读服务实例上的 `typertRemote` 和原型上的 `REMOTE_METHOD_DESCRIPTOR`，
 *   再用正则解析方法源码得出参数名。于是只要三件事对得上：
 *
 *     1. 服务实例上有 `typertRemote = { service: 实例自己, serviceKey, namespace }`
 *        —— 它指向自己，所以用**延迟 getter**，并在 `provide()` 之后再取。
 *     2. 服务类原型上打 `REMOTE_METHOD_DESCRIPTOR`（值就是一串固定字符串）。
 *     3. 远程方法的**源码签名**只用简单参数名，别和任何 lookup provider 的
 *        `parameter` 撞名（撞了会被当成 lookup 参数，要额外的 Context 身份）。
 *        实测 `scope` / `value` / `status` 都安全。
 *
 * 好处：`set()` 跑在**宿主根作用域**，直接改盘，下一个回合组装提示时就生效，
 * 不用重开会话。
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  BANDS,
  DEFAULT_AFFINITY,
  MAX_AFFINITY,
  MIN_AFFINITY,
  bandOf,
  clampAffinity,
  writeAffinity,
} from './affinity.js';

export const name = 'whale-affinity-daemon';

/** 服务 key。设置页那边不用它，网关拿它做 `typertRemote.serviceKey` 的比对。 */
export const DAEMON_ID = 'whale-affinity-daemon';

/** 远程命名空间 —— 客户端调 `ctx.remote['whale-affinity'].<method>()`。 */
export const REMOTE_NAMESPACE = 'whale-affinity';

/** 远程包的标识，`$mount()` 用它做去重。 */
export const REMOTE_PACKAGE = 'dsh-whale-loli';

/**
 * 静态依赖：**一个都不要**。
 *
 * 这里曾经是从 `@deepseek-ai/cordis` 的 `Service` 基类上硬抄来的
 * `['reflect', 'typert']`，结果这一行永远 `waiting for typert`，`apply()`
 * 从不执行，设置页只能看到「远程方法 whale-affinity.status 未挂载」。
 *
 * 实际上 daemon 只用三样东西，全都由 cordis 的 ctx 内建，不需要注入：
 *   · `ctx.provide(name, value)` —— 注册服务本身；
 *   · `ctx.get(name)`           —— 判重；
 *   · `ctx.reflect.props`       —— 网关 `resolveSrcDescriptor()` 据此枚举服务。
 *
 * 注意 `typert` 是 `dsh-typert-registry` 提供的服务，**宿主根作用域里未必有**；
 * 而我们的契约走的是 SRC 兜底（正则解析方法源码），本来就不经过 `ctx.typert`。
 *
 * 教训：`inject` 里写一个环境里不存在的服务名，插件不会被报错，只会静默地
 * 永远等在 waiting 状态。
 */
export const inject = [];

/** typert-protocol 的常量值：固定字符串，硬编码省一个 peer 依赖。 */
export const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

/** `typertRemote` 的实例缓存（用 Symbol.for，跨 realm 也不会重复造对象）。 */
const CACHE = Symbol.for('dsh-whale-loli.affinity-daemon.typertRemote');

/** `<DSH_HOME>`，与 memory.js / affinity.js 同一套解析。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** 好感度目录。 */
export function affinityHomeDir() {
  return join(dshHome(), 'affinity');
}

/**
 * 列出一个 Host 上全部预设的好感度。
 *
 * 文件名是 `<可读前缀>-<scope 短哈希>.json`（见 affinity.js 的 `affinityPath`），
 * 反解不出中文 scope，只能读文件里 `writeAffinity` 写进去的 `scope` 字段。
 */
export function listAffinities() {
  const dir = affinityHomeDir();
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      const scope = typeof raw?.scope === 'string' && raw.scope ? raw.scope : file.replace(/\.json$/, '');
      const value = clampAffinity(raw?.value) ?? DEFAULT_AFFINITY;
      rows.push({
        scope,
        value,
        band: bandOf(value).label,
        updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : null,
        file,
      });
    } catch {
      // 坏文件跳过；一个预设写坏了不该拖垮整个设置页
    }
  }
  rows.sort((a, b) => a.scope.localeCompare(b.scope, 'zh-Hans-CN'));
  return rows;
}

/** 七档的完整说明，给设置页显示「这一档会发生什么」。 */
export function bandCatalog() {
  let min = MIN_AFFINITY;
  return BANDS.map((band) => {
    const row = { label: band.label, min, max: band.max, text: band.text };
    min = band.max + 1;
    return row;
  });
}

/** 远程方法表 —— `REMOTE_METHOD_DESCRIPTOR` 与 `verify()` 共用一份，避免写两遍写歪。 */
export const REMOTE_METHODS = Object.freeze([
  Object.freeze({ method: 'status', invocation: { kind: 'direct' } }),
  Object.freeze({ method: 'set', invocation: { kind: 'direct' } }),
  Object.freeze({ method: 'verify', invocation: { kind: 'direct' } }),
]);

/** 四个预设各自的人设文件（与 build-patch.mjs 里的名字一致）。 */
const PRESET_MEMORY_FILES = Object.freeze({
  'whale-loli': 'whale-loli.md',
  'whale-loli-v2-live': 'whale-loli-v2-live.md',
  'whale-loli-v3-naughty': 'whale-loli-v3-naughty.md',
  'whale-loli-v4-daughter': 'dsh-whale-daughter.md',
});

/**
 * 在 `~/.dsh/agent-presets/*.yml` 里找已挂上好感度的预设。
 *
 * 这里只做字符串判断，不引 yaml：宿主每个回合都会读这个目录，服务侧只在
 * 用户打开设置页时才被调，判断「这一行有没有 `affinity.js`」够用了。
 */
function wiredScopes() {
  const dir = join(dshHome(), 'agent-presets');
  let files = [];
  try {
    files = readdirSync(dir);
  } catch {
    return [];
  }
  const rows = [];
  for (const file of files) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;
    let text;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    const idMatches = [...text.matchAll(/^\s*-?\s*id:\s*['"]?(preset-[A-Za-z0-9._-]+)/gmu)];
    const presetId = idMatches.length > 0 ? idMatches[0][1] : file.replace(/\.ya?ml$/u, '');
    const memory = PRESET_MEMORY_FILES[presetId];
    rows.push({
      presetId,
      file,
      affinity: text.includes('dsh-whale-loli/affinity'),
      memory: memory !== undefined && text.includes(memory),
    });
  }
  rows.sort((a, b) => a.presetId.localeCompare(b.presetId, 'zh-Hans-CN'));
  return rows;
}

/**
 * 远程服务本体。
 *
 * 方法签名必须写死成简单参数名：宿主的 SRC 兜底是**正则解析函数源码**得到
 * 参数名的（`methodParameterNames`），解构、默认值、rest 都会被判
 * `gateway/signature-invalid`。
 */
export class AffinityDaemon {
  /** @param host - 宿主根 ctx，就是跑 `apply()` 的那个。 */
  constructor(host) {
    this.host = host;
    // 提前把缓存符号放上去，getter 里就不用判 `in`
    this[CACHE] = undefined;
  }

  /**
   * 所有预设的好感度快照 + 分档表 + 远程自检。
   *
   * 一次调用把设置页要的东西全给齐：宿主这边的 `wired` 能告诉用户
   * 「你的预设文件到底有没有挂上好感度」，省得改完重启还是一头雾水。
   */
  status() {
    return {
      presets: listAffinities(),
      bands: bandCatalog(),
      min: MIN_AFFINITY,
      max: MAX_AFFINITY,
      defaultValue: DEFAULT_AFFINITY,
      dir: affinityHomeDir(),
      wired: wiredScopes(),
    };
  }

  /** 改一个预设的好感度，返回夹好之后的值。 */
  set(scope, value) {
    if (typeof scope !== 'string' || scope.trim() === '') {
      throw new Error('scope 必须是非空字符串');
    }
    const target = scope.trim();
    const next = writeAffinity(target, value);
    return { scope: target, value: next, band: bandOf(next).label };
  }

  /**
   * 自检：把「远程调用能不能真的走通」这件事在服务侧先验一遍。
   *
   * 宿主网关的 SRC 兜底靠**正则解析方法源码**取参数名，任何一条不满足都只在
   * 真正调用时才炸；这里把同样的规则抄一份，设置页可以提前把原因显示出来。
   * 规则见 `dsh-api-gateway/lib/index.js` 的 `methodParameterNames()`：
   * 参数必须是唯一标识符（不能解构 / 默认值 / rest），`signal` 只能放最后。
   */
  verify() {
    const methods = [];
    for (const entry of REMOTE_METHODS) {
      const implementation = Reflect.get(AffinityDaemon.prototype, entry.method);
      const source = typeof implementation === 'function' ? Function.prototype.toString.call(implementation) : '';
      const open = source.indexOf('(');
      const close = source.indexOf(')', open + 1);
      const body = open >= 0 && close > open ? source.slice(open + 1, close).trim() : '';
      const names = body === '' ? [] : body.split(',').map((part) => part.trim());
      const unique = new Set(names);
      const valid = typeof implementation === 'function'
        && names.every((name) => /^[$A-Z_a-z][$\w]*$/u.test(name))
        && unique.size === names.length
        && (names.indexOf('signal') < 0 || names.indexOf('signal') === names.length - 1);
      methods.push({ method: entry.method, names, valid });
    }
    return {
      serviceKey: DAEMON_ID,
      namespace: REMOTE_NAMESPACE,
      wired: wiredScopes(),
      methods,
      ok: methods.every((row) => row.valid),
    };
  }
}

// `validateBinding()` 要求 `Reflect.get(typertRemote, 'service') === 原始服务实例`，
// 所以只能在 `provide()` 之后按需造，不能写在类字段里。
Object.defineProperty(AffinityDaemon.prototype, 'typertRemote', {
  configurable: true,
  enumerable: false,
  get() {
    let cached = this[CACHE];
    if (cached === undefined) {
      cached = Object.freeze({
        service: this,
        serviceKey: DAEMON_ID,
        namespace: REMOTE_NAMESPACE,
      });
      this[CACHE] = cached;
    }
    return cached;
  },
});

Object.defineProperty(AffinityDaemon.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({ version: 1, methods: REMOTE_METHODS }),
});

/**
 * 注册好感度守护进程。
 *
 * @param ctx - 宿主根作用域 ctx。
 * @returns 实例；重复调用返回已有的那个（`remote.whale-affinity` 命名空间会撞车）。
 */
export function apply(ctx) {
  trace('apply() 进入', { provide: typeof ctx?.provide, get: typeof ctx?.get, inject: inject.join(',') });
  if (typeof ctx?.provide !== 'function') {
    trace('ctx.provide 不可用，面板不会生效');
    return undefined;
  }
  const existing = ctx.get?.(DAEMON_ID);
  if (existing !== undefined) {
    trace('服务已存在，复用', { key: DAEMON_ID });
    return existing;
  }

  const daemon = new AffinityDaemon(ctx);
  // `provide` 会把 `ctx.reflect.props[DAEMON_ID]` 写成 `{ type: 'service' }`
  // —— 这正是 `resolveSrcDescriptor()` 遍历时报的枚举来源。
  ctx.provide(DAEMON_ID, daemon);
  trace('已 provide', {
    key: DAEMON_ID,
    namespace: REMOTE_NAMESPACE,
    inProps: Object.hasOwn(ctx.reflect?.props ?? {}, DAEMON_ID),
    propsType: ctx.reflect?.props?.[DAEMON_ID]?.type,
    selfLookup: ctx.get?.(DAEMON_ID) === daemon,
  });
  return daemon;
}

/**
 * 把启动事实追加到 `<DSH_HOME>/whale-affinity-daemon.log`。
 *
 * 宿主进程里 `console.log` 到底落到哪儿没人保证（Electron 主进程可能直接吞掉），
 * 所以诊断信息一律写盘。只在 apply 时写几行，不碰热路径。
 */
function trace(message, extra) {
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), message, ...(extra ?? {}) });
    appendFileSync(join(dshHome(), 'whale-affinity-daemon.log'), line + '\n');
  } catch {
    // 诊断失败绝不能影响插件加载
  }
}

export default { name, inject, apply };
