// 验证 history-window（compaction 版）：
// 切点算得对、交给宿主 compactRegion、绝不自己写事件、失败不外泄。
import { readFileSync } from 'node:fs';

const mod = await import('./src/history-window.js');

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

/**
 * 造一个假 session。结构照真宿主：user/message 带 source.kind，
 * 偶数轮带一次 tool-call + tool/result（用来验工具配对）。
 * append 被替换成「记录 + 直接抛错」：本插件**绝不该**自己写事件。
 */
function makeSession(spec) {
  const events = new Map();
  const nodes = [];
  let seq = 0;
  const pushed = [];
  const push = (type, data) => {
    seq += 1;
    events.set(seq, { type, seq, data });
    nodes.push(seq);
    return seq;
  };

  push('system/message', { message: { role: 'system', content: [], source: { kind: 'system-prompt' } } });

  for (const turn of spec) {
    push('user/message', { id: `u${turn}`, role: 'user', content: [{ type: 'text', text: `第${turn}轮` }], source: { kind: 'user' } });
    // 每 3 轮插一条运行时上下文：也是 user/message，但不该算一轮
    if (turn % 3 === 0) {
      push('user/message', { id: `c${turn}`, role: 'user', content: [{ type: 'text', text: 'ctx' }], source: { kind: 'runtime-context' } });
    }
    if (turn % 2 === 0) {
      push('assistant/message', { message: { role: 'assistant', content: [{ type: 'tool-call', id: `tc${turn}`, name: 'read', arguments: '{}' }] } });
      push('tool/result', { message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] }, toolCallId: `tc${turn}` });
    } else {
      push('assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: '嗯' }] } });
    }
  }

  return {
    get surface() {
      return { nodes: [...nodes] };
    },
    eventAt: (s) => events.get(s),
    append(type) {
      pushed.push(type);
      throw new Error(`本插件不该自己写事件（尝试写 ${type}）`);
    },
    _pushed: pushed,
    _countTurns() {
      return nodes.map((n) => events.get(n)).filter((e) => mod.isUserTurn(e)).length;
    },
  };
}

console.log('=== 1. 40 轮 → 保留最近 20 轮，压掉更早的 ===');
{
  const s = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  const plan = mod.planCompact(s, 20);
  check('算出范围', plan !== null);
  check('removedTurns = 20', plan?.removedTurns === 20, `实际 ${plan?.removedTurns}`);
  check('keptTurns = 20', plan?.keptTurns === 20);
  const nodes = s.surface.nodes;
  check('起点是第一个 user 节点，不是系统节点', plan?.startSeq === nodes[1], `start=${plan?.startSeq} nodes[1]=${nodes[1]}`);
  check('起点不是 nodes[0]（系统提示永不被压）', plan?.startSeq !== nodes[0]);
  check('起点 < 终点', plan?.startSeq < plan?.endSeq);
  // 终点之后还剩 20 轮
  const endIdx = nodes.indexOf(plan.endSeq);
  const restTurns = nodes.slice(endIdx + 1).map((n) => s.eventAt(n)).filter((e) => mod.isUserTurn(e)).length;
  check('终点之后正好剩 20 轮', restTurns === 20, `实际 ${restTurns}`);
}

console.log('\n=== 2. 不足 20 轮 → 不动 ===');
{
  const s = makeSession(Array.from({ length: 20 }, (_, i) => i + 1));
  check('20 轮整 → null', mod.planCompact(s, 20) === null);
  const s2 = makeSession(Array.from({ length: 7 }, (_, i) => i + 1));
  check('7 轮 → null', mod.planCompact(s2, 20) === null);
}

console.log('\n=== 3. 运行时上下文不算轮 ===');
{
  // 21 轮，其中 7 条 runtime-context（第 3,6,9,12,15,18,21 轮各一条）
  const s = makeSession(Array.from({ length: 21 }, (_, i) => i + 1));
  const totalUserMsgs = s.surface.nodes.map((n) => s.eventAt(n)).filter((e) => e.type === 'user/message').length;
  const realTurns = s._countTurns();
  check('真实轮数 = 21', realTurns === 21, `实际 ${realTurns}`);
  check('user/message 条数 > 21（含运行时上下文）', totalUserMsgs > 21, `实际 ${totalUserMsgs}`);
  const plan = mod.planCompact(s, 20);
  check('只压掉 1 轮（20 轮阈值）', plan?.removedTurns === 1, `实际 ${plan?.removedTurns}`);
}

console.log('\n=== 4. 切点工具配对平衡 ===');
{
  for (const n of [21, 25, 31, 40]) {
    const s = makeSession(Array.from({ length: n }, (_, i) => i + 1));
    const plan = mod.planCompact(s, 20);
    const nodes = s.surface.nodes;
    const cutIdx = nodes.indexOf(plan.endSeq) + 1;
    check(`${n} 轮：切点平衡`, mod.balancedBefore(s, nodes, cutIdx) === true);
  }
}

console.log('\n=== 5. 交给宿主 compactRegion，自己不写事件 ===');
{
  const s = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  const calls = [];
  const ctx = {
    get: (k) => (k === 'compaction' ? { compactRegion: async (start, end, agent) => void calls.push({ start, end, agent }) } : undefined),
    on: () => () => {},
    effect: (f) => f(),
  };
  const agent = { session: s, options: { provider: 'p', model: 'm' } };
  const plan = await mod.compactHistory(ctx, agent, 20);
  check('返回计划', plan !== null);
  check('调用了 compactRegion 一次', calls.length === 1, `实际 ${calls.length}`);
  check('start/end 来自计划', calls[0]?.start === plan.startSeq && calls[0]?.end === plan.endSeq);
  check('agent 原样传进去', calls[0]?.agent === agent);
  check('没有自己写任何事件', s._pushed.length === 0, `实际写了 ${s._pushed.join(',')}`);
}

console.log('\n=== 6. 缺压缩服务 / 抛错 / 无需压缩 ===');
{
  const s = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  const noService = { get: () => undefined, on: () => () => {}, effect: (f) => f() };
  check('没有 compaction 服务 → null', (await mod.compactHistory(noService, { session: s }, 20)) === null);

  const boom = {
    get: () => ({ compactRegion: async () => { throw new Error('boom'); } }),
    on: () => () => {},
    effect: (f) => f(),
  };
  let threw = false;
  try {
    await mod.compactHistory(boom, { session: s }, 20);
  } catch {
    threw = true;
  }
  check('compactRegion 抛错会抛给调用方（由 apply 兜）', threw === true);

  const small = makeSession(Array.from({ length: 5 }, (_, i) => i + 1));
  const calls = [];
  const ctx2 = { get: () => ({ compactRegion: async () => void calls.push(1) }), on: () => () => {}, effect: (f) => f() };
  check('不足 20 轮 → null', (await mod.compactHistory(ctx2, { session: small }, 20)) === null);
  check('不足 20 轮 → 不调压缩', calls.length === 0);
}

console.log('\n=== 7. 挂载行为：默认开启、只在 idle、不阻塞 ===');
{
  let listener;
  const ctxMock = {
    get: () => undefined,
    effect: (f) => f(),
    on: (_name, cb) => {
      listener = cb;
      return () => {};
    },
  };

  // 默认（不传 config）就应该挂上
  mod.apply(ctxMock, {});
  check('默认开启：注册了监听', typeof listener === 'function');

  // enable:false 不挂
  let none = null;
  const ctxOff = { get: () => undefined, effect: (f) => f(), on: (_n, cb) => ((none = cb), () => {}) };
  mod.apply(ctxOff, { enable: false });
  check('enable:false 不注册', none === null);

  // 只在 idle 触发；且不能是 Promise（不能拖住对话）
  const s = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  const calls = [];
  const ctx3 = {
    get: (k) => (k === 'compaction' ? { compactRegion: async (a, b) => void calls.push([a, b]) } : undefined),
    effect: (f) => f(),
    on: (_n, cb) => {
      listener = cb;
      return () => {};
    },
  };
  mod.apply(ctx3, {});
  const ret = listener({ status: 'running', agent: { session: s } });
  check('running 时同步返回 undefined（不返回 Promise）', ret === undefined);
  check('running 时不压缩', calls.length === 0);
  listener({ status: 'idle', agent: { session: s } });
  await new Promise((r) => setTimeout(r, 20));
  check('idle 后触发压缩', calls.length === 1, `实际 ${calls.length}`);
  check('压缩范围与计划一致', calls[0]?.[0] === mod.planCompact(s, 20)?.startSeq);
}

console.log('\n=== 8. 源码不再自己拼事件 ===');
{
  const src = readFileSync('./src/history-window.js', 'utf8');
  check('调用宿主 compactRegion', src.includes('compactRegion'));
  check('不再构造 replace 操作', !src.includes("op: 'replace'"));
  check('不再自己 append 事件', !src.includes(".append('user/message'") && !src.includes(".append('developer/message'"));
  check('挂在 agent/status（idle 时）', src.includes("agent/status"));
  check('保留工具配对平衡判定', src.includes('balancedBefore'));
  check('默认开启（只认 enable === false）', src.includes('config.enable === false'));
}

console.log('\nRESULT:', ok ? 'PASS —— 切点正确、交给宿主压缩、绝不自己写事件' : 'FAIL');
process.exit(ok ? 0 : 1);
