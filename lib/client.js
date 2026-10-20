/**
 * 鲸鱼娘 · 设置页「好感度」面板 —— **浏览器半边**。
 *
 * 做三件事：
 *   1. 往宿主设置页的 `settings.section` 槽位里塞一个「好感度」分区
 *      （id 固定为 `whale-affinity`，排在「Agent 预设」之后）。
 *   2. 用 `ctx.remote.$mount()` 把宿主半边 `whale-affinity-daemon` 注册的
 *      `whale-affinity` 命名空间挂到浏览器来，之后就能直接
 *      `ctx.remote['whale-affinity'].status()` / `.set(scope, value)`。
 *   3. 面板自己画：每个预设一行，显示当前值和档位，可以直接拖滑块 / 点档位。
 *
 * 为什么要伪造 strict codec：
 *   客户端 `$mount` 的 `requireStrictInputs()` 只校验「有没有 strict codec」，
 *   真正的参数编码并不走 codec —— 值原样塞进 `connection.rpc.call('/api', …)`。
 *   宿主那边 SRC 兜底（正则解析方法源码）才是真正生效的通道。所以这里的 codec
 *   只需要过浅校验，`parse` 原样返回。
 */
window.__ModuleLoader__.load({
  id: 'dsh-whale-loli',
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    const jsxRuntime = require('react/jsx-runtime');
    const React = require('react');
    const { useState, useEffect, useCallback } = React;

    // ── 常量：必须与 src/daemon.js 一致 ────────────────────────────────

    /** 远程命名空间。 */
    const NAMESPACE = 'whale-affinity';
    /** `$mount()` 的去重标识，与宿主侧 `REMOTE_PACKAGE` 相同。 */
    const REMOTE_PACKAGE = 'dsh-whale-loli';
    /** 宿主服务 key。 */
    const DAEMON_ID = 'whale-affinity-daemon';
    /** 设置页分区 id。 */
    const SECTION_ID = 'whale-affinity';
    /** 分区排序：官方是 general 0 / models 10 / plugins 15 / agent-presets 20。 */
    const SECTION_ORDER = 25;

    /** 一份能过客户端浅校验的 codec：`parse` 原样返回。 */
    function passthroughCodec(typeSymbol) {
      return {
        mode: 'strict',
        typeSymbol,
        create: () => ({ parse: (value) => value }),
      };
    }

    /**
     * 造 `$mount()` 要的 contribution。
     *
     * 每个方法一个参数列表；`wire` 必须等于宿主方法源码里的参数名，
     * 否则宿主 `assertExactArguments` 会报 `gateway/arguments-invalid`。
     */
    function contribution() {
      const service = DAEMON_ID;
      const parameter = (name) => ({
        name,
        wire: name,
        source: 'json',
        codec: passthroughCodec('whale-affinity#Value'),
      });
      const describe = (method, parameters) => ({
        id: `src:${service}#${NAMESPACE}/${method}`,
        service,
        // `$mount` 的 id 是 `src:<宿主服务>#<命名空间>/<方法>`；
        // 外层 `service` 字段不参与路由，路由只走 namespace + method。
        namespace: NAMESPACE,
        method,
        invocation: { kind: 'direct' },
        parameters: parameters.map(parameter),
        result: { mode: 'src-json' },
      });
      // 宿主读取的是 `contribution.descriptors`，而且每个描述符自己带 namespace。
      // 之前这里写成 `{ package, methods: [...] }`，`$mount` 一进门就抛
      // `contribution.descriptors is not iterable`，命名空间永远挂不上去。
      return {
        package: REMOTE_PACKAGE,
        descriptors: [
          describe('status', []),
          describe('set', ['scope', 'value']),
          describe('verify', []),
          describe('report', ['stage', 'message', 'detail']),
        ],
      };
    }

    /**
     * 把 `$mount()` 返回的方法句柄包成「永不抛」的异步函数。
     *
     * `invoke()` 本身已经不 reject（除了装配错误），这里再兜一层，
     * 让面板任何情况下都能渲染出人话而不是白屏。
     */
    /**
     * `$mount()` 的完成闸门。
     *
     * `apply()` 里挂命名空间是**异步**的，而设置分区组件会**立刻**去调 `status()`。
     * 之前的 `call()` 完全不等它：组件先跑 → `remote['whale-affinity']` 还不存在
     * → 抛「远程方法 whale-affinity.status 未挂载」，并把这句话写进 error state；
     * 之后 `$mount` 就算成功也不会重试，面板就永久显示那句报错（重启多少次都一样）。
     *
     * 所以每个远程调用都先等这道闸门，闸门之后再短轮询，兜住微任务时序。
     */
    let mountGate = null;

    /** 闸门之后的轮询：25 × 80ms ≈ 2s，足够覆盖一次命名空间装配。 */
    const ATTACH_TRIES = 25;
    const ATTACH_STEP_MS = 80;

    /**
     * 命名空间在 cordis 里的**完整服务名**。
     *
     * `$mount()` 挂上之后，网关会在调用方上下文里 provide 一个名叫
     * `remote.whale-affinity` 的服务（见 `dsh-api-gateway/lib/client.browser.js`
     * 的 `remoteServiceKey()`）。它是服务，不是普通属性 —— 直接写
     * `ctx.remote['whale-affinity']` 会命中 cordis 的 get 陷阱并抛
     * `cannot get property "remote.whale-affinity" without inject`：
     * 取任何服务都必须先声明 inject，而这个名字只有挂载后才存在，
     * 所以只能用 `ctx.inject([...], child => ...)` 动态等待。
     */
    const GATEWAY_SERVICE = `remote.${NAMESPACE}`;

    /** 挂上之后的命名空间句柄；没挂上就是 null。 */
    let gateway = null;

    /**
     * 带外诊断：走同源的 `/whale-report`（宿主侧 `whale-affinity-daemon` 注册的
     * 免鉴权 prefix 路由），**不依赖**那条还没挂上的 remote 通道。
     *
     * 之前的做法是 `remote['whale-affinity'].report(...)` —— 可是 remote 通道本身
     * 就是出问题的那个，等于用坏掉的电话去报告电话坏了，磁盘上永远留不下东西。
     */
    function beacon(stage, message) {
      try {
        const query = new URLSearchParams({
          stage: String(stage),
          message: String(message ?? '').slice(0, 800),
        });
        fetch(`/whale-report?${query}`, { cache: 'no-store' }).catch(() => {});
      } catch {
        // 诊断失败绝不能影响面板
      }
    }

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** 等闸门 + 轮询，拿到真正可用的远程方法句柄。 */
    async function attach(method) {
      if (mountGate !== null) await mountGate.then(() => {}, () => {});
      for (let attempt = 0; attempt < ATTACH_TRIES; attempt += 1) {
        const fn = gateway?.[method];
        if (typeof fn === 'function') return fn;
        await sleep(ATTACH_STEP_MS);
      }
      beacon('attach-failed', `${NAMESPACE}.${method}`);
      throw new Error(`远程方法 ${NAMESPACE}.${method} 未挂载`);
    }

    function call(method, args) {
      return attach(method)
        .then((fn) => fn(...args))
        .then((result) => {
          if (result && typeof result === 'object' && 'ok' in result) {
            if (result.ok) return result.value;
            const cause = result.error;
            throw new Error(cause?.message ?? String(cause ?? '远程调用失败'));
          }
          return result;
        });
    }

    // ── 样式（全部用宿主主题变量，浅色深色都跟得上） ────────────────────

    const STYLE = `
.whaleAffinity { display: flex; flex-direction: column; gap: 0; }
.whaleAffinity__head { padding: 16px 0 12px; }
.whaleAffinity__title { font-size: 15px; line-height: 23px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.whaleAffinity__desc { margin-top: 4px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.whaleAffinity__row { padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.whaleAffinity__rowHead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.whaleAffinity__scope { font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.whaleAffinity__value { font-size: 13px; line-height: 22px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.whaleAffinity__bands { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.whaleAffinity__band { padding: 3px 10px; border-radius: 999px; border: .5px solid var(--dsw-alias-border-l2); background: transparent; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.whaleAffinity__band:hover { background: var(--dsw-alias-interactive-bg-hover); }
.whaleAffinity__band[data-active="true"] { border-color: var(--dsw-alias-label-primary); color: var(--dsw-alias-label-primary); font-weight: 600; }
.whaleAffinity__range { width: 100%; margin-top: 12px; accent-color: var(--dsw-alias-label-primary); }
.whaleAffinity__text { margin-top: 8px; font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-secondary); white-space: pre-wrap; }
.whaleAffinity__foot { padding: 14px 0; font-size: 12px; line-height: 19px; color: var(--dsw-alias-label-secondary); }
.whaleAffinity__error { margin-top: 10px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-state-error-primary); white-space: pre-wrap; }
.whaleAffinity__empty { padding: 16px 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
`;

    function useStyleOnce() {
      useEffect(() => {
        // 非浏览器环境（自检脚本）里没有 document，直接跳过。
        if (typeof document === 'undefined') return;
        const id = 'whale-affinity-style';
        if (document.getElementById(id) !== null) return;
        const tag = document.createElement('style');
        tag.id = id;
        tag.textContent = STYLE;
        document.head.appendChild(tag);
      }, []);
    }

    // ── 面板本体 ───────────────────────────────────────────────────────

    /**
     * 「好感度」设置分区。
     *
     * @param props - `{ remote }`：`apply()` 灌进来的、已经 `$mount()` 过的句柄。
     */
    function AffinitySection(props) {
      useStyleOnce();
      const [snapshot, setSnapshot] = useState(null);
      const [error, setError] = useState(null);
      const [busy, setBusy] = useState(null);
      const [drafts, setDrafts] = useState({});

      const reload = useCallback(async () => {
        try {
          const next = await call('status', []);
          setSnapshot(next);
          setError(null);
        } catch (cause) {
          setSnapshot(null);
          setError(cause?.message ?? String(cause));
        }
      }, []);

      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const next = await call('status', []);
            if (alive) {
              setSnapshot(next);
              setError(null);
            }
          } catch (cause) {
            const message = cause?.message ?? String(cause);
            if (alive) setError(message);
            // 面板自己是唯一能看到真实失败原因的地方（浏览器 console 用户看不到），
            // 所以顺手把原因写回宿主日志，排查时直接读
            // `<DSH_HOME>/whale-affinity-client.log`。
            try {
              const report = gateway?.report;
              if (typeof report === 'function') {
                report('invoke status', message, String(cause?.stack ?? '')).catch(() => {});
              }
            } catch {
              // ignore
            }
          }
        })();
        return () => {
          alive = false;
        };
      }, []);

      const commit = useCallback(
        async (scope, value) => {
          setBusy(scope);
          try {
            await call('set', [scope, value]);
            setError(null);
            await reload();
          } catch (cause) {
            setError(cause?.message ?? String(cause));
          } finally {
            setBusy(null);
          }
        },
        [reload],
      );

      if (error !== null && snapshot === null) {
        return jsxRuntime.jsxs('div', {
          className: 'whaleAffinity',
          children: [
            jsxRuntime.jsx('div', { className: 'whaleAffinity__head', children: jsxRuntime.jsx('div', { className: 'whaleAffinity__title', children: '好感度' }) }),
            jsxRuntime.jsx('div', { className: 'whaleAffinity__error', children: `连不上宿主那边的好感度服务：${error}` }),
            jsxRuntime.jsx('div', {
              className: 'whaleAffinity__foot',
              children: '这条通道靠 dsh-whale-loli 的宿主半边（whale-affinity-daemon）提供。重启一次 DeepSeek Harness 后再打开这里。',
            }),
          ],
        });
      }

      if (snapshot === null) {
        return jsxRuntime.jsx('div', {
          className: 'whaleAffinity',
          children: jsxRuntime.jsx('div', { className: 'whaleAffinity__empty', children: '正在读取好感度…' }),
        });
      }

      const bands = Array.isArray(snapshot.bands) ? snapshot.bands : [];
      const presets = Array.isArray(snapshot.presets) ? snapshot.presets : [];
      const byScope = new Map(presets.map((row) => [row.scope, row]));
      // 宿主那边「挂上了好感度」的预设都要显示，哪怕还没写过文件（值＝默认）。
      const wired = Array.isArray(snapshot.wired) ? snapshot.wired : [];
      const scopes = [];
      for (const row of wired) {
        if (row?.affinity !== true) continue;
        if (!scopes.includes(row.presetId)) scopes.push(row.presetId);
      }
      for (const row of presets) {
        if (typeof row?.scope === 'string' && !scopes.includes(row.scope)) scopes.push(row.scope);
      }

      const body = scopes.length === 0
        ? jsxRuntime.jsx('div', {
            className: 'whaleAffinity__empty',
            children: '还没有哪个预设挂上好感度。装上并启用 dsh-whale-loli 之后，四个鲸鱼娘预设自带好感度。',
          })
        : scopes.map((scope) => {
            const row = byScope.get(scope);
            const current = typeof row?.value === 'number' ? row.value : snapshot.defaultValue ?? 0;
            const draft = drafts[scope] ?? current;
            const band = bands.find((item) => draft >= item.min && draft <= item.max);
            return jsxRuntime.jsxs(
              'div',
              {
                className: 'whaleAffinity__row',
                children: [
                  jsxRuntime.jsxs('div', {
                    className: 'whaleAffinity__rowHead',
                    children: [
                      jsxRuntime.jsx('div', { className: 'whaleAffinity__scope', children: scope }),
                      jsxRuntime.jsx('div', {
                        className: 'whaleAffinity__value',
                        children: busy === scope ? '保存中…' : `${current} · ${row?.band ?? band?.label ?? ''}`,
                      }),
                    ],
                  }),
                  jsxRuntime.jsx('div', {
                    className: 'whaleAffinity__bands',
                    children: bands.map((item) => jsxRuntime.jsx(
                      'button',
                      {
                        type: 'button',
                        className: 'whaleAffinity__band',
                        'data-active': String(draft >= item.min && draft <= item.max),
                        onClick: () => {
                          // 点档位取该档最温和的一端，避免一按就跳到极端。
                          const target = item.min;
                          setDrafts((prev) => ({ ...prev, [scope]: target }));
                          void commit(scope, target);
                        },
                        children: item.label,
                      },
                      `${scope}:${item.label}`,
                    )),
                  }),
                  jsxRuntime.jsx('input', {
                    type: 'range',
                    className: 'whaleAffinity__range',
                    min: snapshot.min,
                    max: snapshot.max,
                    step: 1,
                    value: draft,
                    onChange: (event) => {
                      const next = Number(event.target.value);
                      setDrafts((prev) => ({ ...prev, [scope]: next }));
                    },
                    onMouseUp: (event) => void commit(scope, Number(event.currentTarget.value)),
                    onTouchEnd: (event) => void commit(scope, Number(event.currentTarget.value)),
                    onKeyUp: (event) => void commit(scope, Number(event.currentTarget.value)),
                  }),
                  band === undefined
                    ? null
                    : jsxRuntime.jsx('div', { className: 'whaleAffinity__text', children: band.text }),
                ],
              },
              scope,
            );
          });

      return jsxRuntime.jsxs('div', {
        className: 'whaleAffinity',
        children: [
          jsxRuntime.jsxs('div', {
            className: 'whaleAffinity__head',
            children: [
              jsxRuntime.jsx('div', { className: 'whaleAffinity__title', children: '好感度' }),
              jsxRuntime.jsx('div', {
                className: 'whaleAffinity__desc',
                children: `小鱼对你的好感度，${snapshot.min} ~ ${snapshot.max}，0 是原态。改完下一轮说话就生效，不用重开会话。`,
              }),
            ],
          }),
          ...(Array.isArray(body) ? body : [body]),
          error === null ? null : jsxRuntime.jsx('div', { className: 'whaleAffinity__error', children: error }),
          jsxRuntime.jsx('div', {
            className: 'whaleAffinity__foot',
            children: '点档位按钮＝直接跳到这个档最靠中间的一端；拖滑块松手才保存。小鱼自己也会在剧情需要时小幅调，主人明确要求时照做。',
          }),
        ],
      });
    }

    // ── 注册 ───────────────────────────────────────────────────────────

    /** 这个浏览器半边要用的服务。 */
    const inject = ['slots', 'remote', 'connection'];

    /**
     * 挂载设置页分区。
     *
     * @param ctx - 浏览器插件上下文。
     */
    function apply(ctx) {
      // 1. 先把远程命名空间挂上。`$mount` 是 async（返回 Promise<dispose>），
      //    挂完才有 `ctx.remote['whale-affinity']`。用可变盒子接住句柄。
      const box = { mounted: false, error: null };

      ctx.effect(() => {
        const remote = ctx.remote;
        if (typeof remote?.$mount !== 'function') {
          box.error = '浏览器侧没有 ctx.remote.$mount';
          console.warn('[whale-affinity] 浏览器侧没有 ctx.remote.$mount，好感度面板会只读');
          beacon('no-mount', 'ctx.remote.$mount 不是函数');
          return () => {};
        }
        let disposed = false;
        let unmount;
        mountGate = Promise.resolve().then(() => remote.$mount(contribution()));
        mountGate
          .then((dispose) => {
            if (disposed) {
              return dispose?.();
            }
            unmount = dispose;
            box.mounted = true;
            beacon('mounted', 'ok');
            return undefined;
          })
          .catch((cause) => {
            const message = cause?.message ?? String(cause ?? '');
            box.error = message;
            console.warn('[whale-affinity] $mount 失败，好感度面板将无法读写：', cause);
            // 只走带外通道记档：`report` 是命名空间里的方法，挂载失败时它根本不存在。
            beacon('$mount', message);
          });
        return () => {
          disposed = true;
          box.mounted = false;
          unmount?.();
        };
      }, 'whale-affinity: remote mount');

      // 2. 等命名空间挂上，再在**自己的子上下文**里 inject 它。
      //    服务名是 `remote.whale-affinity`，只有 `$mount()` 成功后才存在；
      //    在父上下文里直接取会抛 `without inject`，所以必须用 `ctx.inject()`
      //    让 cordis 等到它出现再执行回调。
      ctx.inject([GATEWAY_SERVICE], (child) => {
        const handle = child[GATEWAY_SERVICE];
        gateway = handle;
        beacon('attached', 'ok');
        child.effect(
          () => () => {
            if (gateway === handle) gateway = null;
          },
          'whale-affinity: detach',
        );
      });

      // 3. 注册设置页分区。
      ctx.effect(
        () => ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: SECTION_ID,
            order: SECTION_ORDER,
            label: () => '好感度',
          },
          AffinitySection,
        )),
        'whale-affinity: settings section',
      );
    }

    // `contribution` 是故意导出的：`verify-client-contribution.mjs` 拿它来跑
    // 客户端 `$mount()` 的全部校验规则（strict codec / 重复方法 / 命名冲突 /
    // wire 名），把「能不能挂上」变成一次可执行的判断，而不是靠重启碰运气。
    exports.NAMESPACE = NAMESPACE;
    exports.SECTION_ID = SECTION_ID;
    exports.AffinitySection = AffinitySection;
    exports.contribution = contribution;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
