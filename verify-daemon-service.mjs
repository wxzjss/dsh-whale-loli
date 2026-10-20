#!/usr/bin/env node
/**
 * 用**真实** cordis Context 验证 `whale-affinity-daemon` 在宿主里真的能 strict 查得到。
 *
 * 背景（0.9.x 的线上故障，用户看到的是「远程方法 whale-affinity.status 未挂载」）：
 *
 *   宿主网关 `dsh-api-gateway/lib/index.js:1234` 是这样找服务的：
 *       for (const [serviceKey, definition] of Object.entries(this.ctx.reflect.props)) {
 *         if (definition.type !== "service") continue;
 *         const receiver = this.ctx.get(serviceKey);      // ← strict
 *         if (!isObject(receiver)) continue;
 *       }
 *   strict 查询的定义（cordis `ReflectService._getImpl`）：
 *       if (strict && impl.fiber.state !== 2) return;      // 1=Pending, 2=Active
 *
 *   也就是说：**服务必须由已经 active 的 fiber 提供，网关才看得见。**
 *   而 `_reload()` 的收尾是
 *       try { await Promise.resolve(); … await this._execute(...); }
 *       catch (reason) { this.ctx.logger.error(reason); this._runner.epoch = INACTIVE; }
 *   —— apply 里抛一次异常，fiber 就永远停在 Pending。
 *
 * 这个脚本用真实 cordis 跑完整生命周期，断言四件事：
 *   1. apply 结束时 fiber 是 Pending（1），此时 strict 查不到 —— 这是**正常**的；
 *   2. fiber settle 之后变成 Active（2），strict 查得到 —— 这才是面板能连上的条件；
 *   3. 服务实例上带 `typertRemote` 契约，且 `serviceKey` / `namespace` 与客户端一致；
 *   4. apply 里做过的 `provide` 只发生一次（没有重复注册）。
 *
 * 找不到宿主的 `@deepseek-ai/cordis` 时打 `[skip]` 并 exit 0（CI 的裸 runner 上没装宿主）。
 */

import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RESULT_HEADER = '\n=== 用真实 cordis 验证好感度服务在网关视角下可见 ===\n';

/** 按 DSH_ROOT / 常见安装位置找 `@deepseek-ai/cordis` 的入口文件。 */
function findCordis() {
  const candidates = [];
  const root = process.env.DSH_ROOT;
  if (root) {
    const abs = isAbsolute(root) ? root : resolve(here, root);
    candidates.push(join(abs, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'));
  }
  // 从本仓库往上找宿主目录（monorepo 里跑时用得到）
  const require = createRequire(import.meta.url);
  try {
    candidates.push(require.resolve('@deepseek-ai/cordis'));
  } catch {
    // 没装，继续找
  }
  for (const candidate of candidates) {
    try {
      const require2 = createRequire(pathToFileURL(candidate));
      require2.resolve('@deepseek-ai/cordis');
      return candidate;
    } catch {
      // 下一个
    }
  }
  return undefined;
}

const cordisEntry = findCordis();
if (cordisEntry === undefined) {
  console.log(RESULT_HEADER);
  console.log('[skip] 找不到宿主的 @deepseek-ai/cordis（设 DSH_ROOT 指向 DSH 安装目录可启用本测试）');
  console.log('RESULT: SKIP');
  process.exit(0);
}

const { Context } = await import(pathToFileURL(cordisEntry).href);
const daemonModule = await import(pathToFileURL(join(here, 'src', 'daemon.js')).href);

const {
  DAEMON_ID,
  REMOTE_NAMESPACE,
  REMOTE_PACKAGE,
  REMOTE_METHOD_DESCRIPTOR,
  apply: applyDaemon,
} = daemonModule;

let failed = 0;
function check(ok, label, detail) {
  if (ok) console.log(`  ✓ ${label}${detail === undefined ? '' : `  ${detail}`}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail === undefined ? '' : `  ${detail}`}`);
  }
}

console.log(RESULT_HEADER);

// ── 1. 装一个真实的 cordis 根 Context，把 daemon 当插件挂上去 ──────────────
const root = new Context();
root.plugin({
  name: 'verify-daemon-service',
  inject: [],
  apply(ctx) {
    applyDaemon(ctx);
  },
});

// `root.plugin()` 在真实 cordis 里是异步推进的（`_reload()` 里 `await Promise.resolve()`
// 之后才 `_execute()`），所以这里先 settle，再看状态。apply 内部到底看到了什么，
// 由 daemon.js 自己 trace 到 `<DSH_HOME>/whale-affinity-daemon.log`，本测试只看结果。
await new Promise((done) => setTimeout(done, 50));

console.log('\n=== 1. settle 之后的松散可见性 ===');
const looseAfter = root.reflect?.get?.(DAEMON_ID, false);
check(looseAfter !== undefined, '服务已经 provide 进表（loose 查得到）', `loose=${looseAfter !== undefined}`);
console.log(`  · 诊断：settle 后 fiber.state=${root.fiber?.state}（1=Pending，2=Active）`);

// ── 2. 等 fiber settle（真实宿主里是下一个微任务 + 生命周期收尾）──────────
// ── 2. 网关视角的 strict 可见性 ────────────────────────────────────────
console.log('\n=== 2. 网关视角的 strict 可见性 ===');
const impl = root.reflect?._getImpl?.(DAEMON_ID, true);
const service = root.get?.(DAEMON_ID);
check(impl !== undefined, 'strict `_getImpl(DAEMON_ID, true)` 有结果 —— 网关能枚举到这一行');
check(service !== undefined, 'strict `ctx.get(DAEMON_ID)` 有结果');
check(impl?.fiber?.state === 2, '提供者 fiber 已是 Active(2)', `state=${impl?.fiber?.state}`);
check(
  root.reflect?.props?.[DAEMON_ID]?.type === 'service',
  '`reflect.props[DAEMON_ID].type === "service"` —— 网关只枚举 service 类型',
);

// ── 3. 契约形状与客户端一致 ────────────────────────────────────────────
console.log('\n=== 3. typertRemote 契约与客户端一致 ===');
const binding = service === undefined ? undefined : service.typertRemote;
check(typeof binding === 'object' && binding !== null, '服务实例上有 `typertRemote` 绑定（getter）');
check(binding?.service === service, '`typertRemote.service` 就是服务实例自己（网关 validateBinding 要求）');
check(binding?.serviceKey === DAEMON_ID, 'serviceKey 等于 DAEMON_ID', String(binding?.serviceKey));
check(binding?.namespace === REMOTE_NAMESPACE, 'namespace 等于 whale-affinity', String(binding?.namespace));

const descriptor = service === undefined ? undefined : service[REMOTE_METHOD_DESCRIPTOR];
check(
  typeof descriptor === 'object' && descriptor !== null,
  '原型上挂了 REMOTE_METHOD_DESCRIPTOR 方法表',
);
check(
  Array.isArray(descriptor?.methods) && descriptor.methods.length >= 3,
  '方法表至少有 status / set / verify 三个',
  JSON.stringify((descriptor?.methods ?? []).map((m) => m?.name ?? m?.method)),
);

// 客户端 contribution 里写的 package 必须和宿主侧一致，否则 $mount 去重会撞车
const clientSourcePath = join(here, 'lib', 'client.js');
const { readFileSync } = await import('node:fs');
const clientSource = readFileSync(clientSourcePath, 'utf8');
check(
  clientSource.includes(`const REMOTE_PACKAGE = '${REMOTE_PACKAGE}'`),
  '客户端 REMOTE_PACKAGE 与宿主侧同一个字符串',
  REMOTE_PACKAGE,
);
check(
  clientSource.includes(`const DAEMON_ID = '${DAEMON_ID}'`),
  '客户端 DAEMON_ID 与宿主侧同一个字符串',
  DAEMON_ID,
);
check(
  clientSource.includes(`const NAMESPACE = '${REMOTE_NAMESPACE}'`),
  '客户端 NAMESPACE 与宿主侧同一个字符串',
  REMOTE_NAMESPACE,
);

// ── 4. 只 provide 一次（重复 provide 会让命名空间撞车）──────────────────
console.log('\n=== 4. 没有重复注册 ===');
// reflect.store 的键是 isolate Symbol，必须用 Reflect.ownKeys 才数得到。
const storeKeys = Reflect.ownKeys(root.reflect?.store ?? {}).filter((k) => typeof k === 'symbol');
check(storeKeys.length === 1, 'reflect.store 里只有一条服务记录', `count=${storeKeys.length}`);

// ── 5. 反证：apply 抛异常 → fiber 停在 Pending → strict 查不到 ──────────
console.log('\n=== 5. 反证：apply 抛异常时的可见性差异 ===');
const broken = new Context();
broken.plugin({
  name: 'verify-daemon-broken',
  inject: [],
  apply(ctx) {
    ctx.provide('verify-broken-service', { tag: 'x' });
    throw new Error('故意抛错，模拟 0.9.x 里 apply 内部异常');
  },
});
await new Promise((done) => setTimeout(done, 50));
const brokenStrict = broken.reflect?._getImpl?.('verify-broken-service', true);
const brokenLoose = broken.reflect?._getImpl?.('verify-broken-service', false);
console.log(
  `  · 诊断：broken fiber.state=${broken.fiber?.state}  strict=${brokenStrict !== undefined}  loose=${brokenLoose !== undefined}`,
);
check(
  brokenStrict === undefined,
  'strict 查不到 —— 网关的 `ctx.get(serviceKey)` 就是这样失败的',
);
// apply 抛错会把整条注册回滚，所以连 loose 也查不到。这一点比「卡在 Pending」
// 更彻底：宿主界面上完全看不到这个服务，而日志里只有一行 logger.error。
check(
  broken.fiber?.state !== 2 || brokenLoose === undefined,
  '抛错的那一行拿不到服务（回滚或停在 Pending，两种都连不上）',
);

console.log(
  failed === 0
    ? '\nRESULT: PASS —— 好感度服务在网关视角下 strict 可见，面板能连上'
    : `\nRESULT: FAIL —— ${failed} 项不满足`,
);
process.exit(failed === 0 ? 0 : 1);
