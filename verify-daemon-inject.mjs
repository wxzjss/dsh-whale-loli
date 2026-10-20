// 回归测试：宿主级守护进程的 `inject` 声明必须能被满足。
//
// 背景（0.9.2 的真实事故）：设置页出现了「好感度」，但一点开就报
//   「连不上宿主那边的好感度服务：远程方法 whale-affinity.status 未挂载」
//
// 根因：`src/daemon.js` 里 `export const inject = ['reflect', 'typert']`。
// `typert` 是 `dsh-typert-registry` 提供的服务（该包 `super(ctx, "typert")`），
// 而它既不在 profile 的 cordis.patch.yml 里，也不在 dsh.profile.bundles 里。
// cordis 的语义是：`inject` 里写着但环境里没有的服务，**不报错，只静静等待**。
// 于是那一行永远停在 waiting 状态，`apply()` 一次都没执行，
// `ctx.provide('whale-affinity-daemon', …)` 自然也没发生，
// 网关 `resolveSrcDescriptor()` 遍历 `ctx.reflect.props` 时找不到它。
//
// 教训：`inject` 是静态声明，写错一个名字的代价是「插件静默失效」，
// 而且报错信息完全不提 inject（历史上 compaction 也踩过一模一样的坑：
// `waiting for compaction` → `resume failed`）。
//
// 本脚本把 daemon 真正用到的 ctx 能力列成白名单，任何超出的服务名都判红。

import { readFileSync } from 'node:fs';

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

const daemon = await import('./src/daemon.js');
const index = await import('./src/index.js');

console.log('=== 1. 守护进程不得要求任何服务 ===');
const daemonInject = daemon.inject;
console.log('   daemon.inject =', JSON.stringify(daemonInject));
check('daemon.inject 是数组', Array.isArray(daemonInject), typeof daemonInject);
check(
  'daemon.inject 为空（只用 cordis 内建能力）',
  Array.isArray(daemonInject) && daemonInject.length === 0,
  JSON.stringify(daemonInject),
);

// 反证：这几个名字都属于「宿主根作用域未必有」的高危项。
// typert 由 dsh-typert-registry 提供；compaction 由 dsh-compaction(-basic) 提供。
// 两个都真实坑过我们这个项目。
const FORBIDDEN = ['typert', 'compaction', 'commands', 'reflect'];
for (const name of FORBIDDEN) {
  check(
    `daemon.inject 不含 ${JSON.stringify(name)}`,
    Array.isArray(daemonInject) && !daemonInject.includes(name),
  );
}

console.log('\n=== 2. 守护进程源码里只碰 cordis 内建能力 ===');
const source = readFileSync(new URL('./src/daemon.js', import.meta.url), 'utf8');
// 去掉注释再扫，避免文档里提到的服务名造成误报
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const used = [...new Set([...code.matchAll(/ctx\.(provide|get|reflect|effect|on|inject|typert)\b/g)].map((m) => m[1]))];
console.log('   用到的 ctx 成员 =', JSON.stringify(used));
const ALLOWED = new Set(['provide', 'get', 'reflect', 'effect', 'on']);
const overreach = used.filter((m) => !ALLOWED.has(m));
check(
  '只使用白名单里的 ctx 成员',
  overreach.length === 0,
  overreach.length === 0 ? '' : `越界：${overreach.join(', ')}`,
);

console.log('\n=== 3. 默认导出（记忆 + daemon 共用那一行）仍然可被满足 ===');
const rowInject = index.default.inject;
console.log('   default.inject =', JSON.stringify(rowInject));
check('default.inject 是数组', Array.isArray(rowInject));
check('default.apply 是函数', typeof index.default.apply === 'function');
// 记忆行的 inject 是 ['systemPrompt','tools']，两个都是预设作用域必然存在的服务。
// 并集里绝不能因为 daemon 而混进 typert 之类的东西。
for (const name of FORBIDDEN.filter((n) => n !== 'reflect')) {
  check(`default.inject 不含 ${JSON.stringify(name)}`, !rowInject.includes(name), JSON.stringify(rowInject));
}

console.log('\n=== 4. applyEntry 真的按 config.daemon 分派 ===');
const calls = [];
const stubCtx = {
  provide: (key, value) => { calls.push(['provide', key]); },
  get: () => undefined,
  reflect: { props: Object.create(null) },
  logger: { info() {}, warn() {}, error() {} },
  // 0.9.4 起 apply 把 provide 放进 ctx.effect()（等 fiber 变 Active，strict 可见）。
  // 真实 cordis 在跑 effect 回调**之前**就把 fiber 置为 active，所以 stub 直接同步调用回调。
  effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {}; },
};
// 不给 daemon:true → 走记忆行（记忆行会尝试 systemPrompt.variable / tools.register，
// 这里只关心「有没有走到 daemon 的 provide」，所以只断言没 provide 好感度服务）。
try {
  index.default.apply(stubCtx, { file: 'whale-loli.md', variableName: 'whale_memory' });
} catch (e) {
  // 记忆行在残缺 stub 上抛错是可接受的；关键是别 provide 出好感度服务
  console.log('   （记忆行在残缺 stub 上抛出，预期内）', e.message.slice(0, 60));
}
check(
  '不带 daemon:true 时不会 provide 好感度服务',
  !calls.some(([, key]) => key === daemon.DAEMON_ID),
  JSON.stringify(calls),
);

// 带 daemon:true → 必须 provide
index.default.apply(stubCtx, { daemon: true });
check(
  '带 daemon:true 时 provide 了好感度服务',
  calls.some(([, key]) => key === daemon.DAEMON_ID),
  JSON.stringify(calls),
);

console.log('\nRESULT:', ok ? 'PASS —— 守护进程的 inject 声明可满足，宿主能真正 apply 到它' : 'FAIL');
process.exit(ok ? 0 : 1);
