#!/usr/bin/env node
/**
 * 用**真实** cordis 验证「动态 inject 命名空间服务」这条取法是对的。
 *
 * 背景（0.9.7 之后用户看到的报错）：
 *
 *   cannot get property "remote.whale-affinity" without inject
 *
 *   网关 `$mount()` 挂上命名空间后，会在调用方上下文里 provide 一个名字就叫
 *   `remote.whale-affinity` 的**服务**（`dsh-api-gateway/lib/client.browser.js`
 *   的 `remoteServiceKey(ns) => \`remote.${ns}\``）。cordis 的 get 陷阱
 *   （`node_modules/@deepseek-ai/cordis/lib/index.js:676`）对「不在 fiber.store
 *   里、也没 inject」的属性一律抛：
 *       cannot get property "${prop}" without inject
 *   而 `remote['whale-affinity']` 会被服务上的 `tracker.associate` 重定向成
 *   `ctx['remote.whale-affinity']` —— 所以面板里那种写法必然炸。
 *
 *   正确的写法只有一种：等它出现之后，在**自己的子上下文**里取：
 *       ctx.inject(['remote.whale-affinity'], (child) => {
 *         const gateway = child['remote.whale-affinity'];
 *       });
 *
 * 这个脚本用真实 cordis 断言四件事：
 *   1. 服务名确实带点号，且能被 `ctx.inject()` 等到；
 *   2. 子上下文里能拿到实例，并且方法能真调；
 *   3. **反证**：不走 inject、直接在父上下文里取，抛的正是那句报错；
 *   4. 服务还没 provide 时 inject 会等（不报错、也不提前回调）。
 *
 * 找不到宿主的 `@deepseek-ai/cordis` 时打 `[skip]` 并 exit 0（CI 裸 runner 上没装宿主）。
 */

import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RESULT_HEADER = '\n=== 用真实 cordis 验证动态 inject 命名空间服务 ===\n';
const SERVICE = 'remote.whale-affinity';

/** 按 DSH_ROOT / 常见安装位置找 `@deepseek-ai/cordis` 的入口文件。 */
function findCordis() {
  const candidates = [];
  const root = process.env.DSH_ROOT;
  if (root) {
    const abs = isAbsolute(root) ? root : resolve(here, root);
    candidates.push(join(abs, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js'));
  }
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

let failed = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ✓ ${label}${detail === undefined ? '' : `  ${detail}`}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail === undefined ? '' : `  ${detail}`}`);
  }
}

const settle = () => new Promise((done) => setTimeout(done, 60));

console.log(RESULT_HEADER);

// ── 1. 复刻网关：先注册一个 "等待者"，再 provide 服务 ──────────────────

const waiters = [];
let received = null;
let receivedAt = 'never';

const consumer = {
  name: 'consumer',
  inject: [],
  apply(ctx) {
    ctx.inject([SERVICE], (child) => {
      received = child[SERVICE];
      receivedAt = 'injected';
    });
    waiters.push('inject 已登记');
  },
};

const provider = {
  name: 'provider',
  inject: [],
  apply(ctx) {
    ctx.provide(SERVICE, {
      status: async () => ({ ok: true, value: { mounted: true, service: SERVICE } }),
    });
  },
};

const root = new Context();
root.plugin(consumer);
await settle();
check('服务还没 provide 时 inject 只登记、不回调', received === null && waiters.length === 1, String(receivedAt));

root.plugin(provider);
await settle();
check('服务 provide 之后 inject 回调拿到了实例', received !== null && typeof received === 'object', String(receivedAt));

if (received !== null) {
  const answer = await received.status();
  check(
    '拿到的实例能真调方法',
    answer?.ok === true && answer?.value?.mounted === true,
    JSON.stringify(answer),
  );
}

// ── 2. 反证：不走 inject 直接取，必须抛那句话 ──────────────────────────

let bareError = null;
const bare = {
  name: 'bare',
  inject: [],
  apply(ctx) {
    try {
      // 面板里原来的写法就长这样（`remote['whale-affinity']` 会被重定向成这个名字）
      const value = ctx[SERVICE];
      bareError = new Error(`意外拿到了 ${String(value)}`);
    } catch (cause) {
      bareError = cause;
    }
  },
};
root.plugin(bare);
await settle();
check(
  '不 inject 直接取会抛「without inject」',
  typeof bareError?.message === 'string' && bareError.message.includes('without inject'),
  bareError?.message ?? '(没有报错)',
);
check(
  '报错里点名的是带点号的服务名',
  typeof bareError?.message === 'string' && bareError.message.includes(SERVICE),
  bareError?.message ?? '(没有报错)',
);

// ── 3. 客户端源码必须走 inject，不能在服务对象上取命名空间 ─────────────

const { readFileSync } = await import('node:fs');
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8');
check('客户端用 ctx.inject 动态等待命名空间', source.includes('ctx.inject([GATEWAY_SERVICE]'));
check('客户端不再在 remote 服务对象上取命名空间', !/remote\?\.\[NAMESPACE\]/u.test(source));
check('客户端把服务名拼成 `remote.<namespace>`', source.includes('const GATEWAY_SERVICE = `remote.${NAMESPACE}`'));

console.log('');
if (failed > 0) {
  console.log(`RESULT: FAIL —— ${failed} 项不通过`);
  process.exit(1);
}
console.log('RESULT: PASS —— 动态 inject 拿命名空间这条路成立，直接取必然抛 without inject');
