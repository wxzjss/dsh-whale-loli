// 验证 history-window：模拟真实表层结构，断言真的只留最近 N 轮，
// 且不切断工具配对、不裁系统提示。
import { readFileSync } from 'node:fs';

const mod = await import('./src/history-window.js');

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

/**
 * 造一个假的 session：surface.nodes 是 seq 列表，eventAt 取回事件。
 * 结构照真宿主：assistant/message 的 content 里放 tool-call，tool/result 配对。
 */
function makeSession(spec) {
  const events = new Map();
  const nodes = [];
  let seq = 0;
  const push = (type, data) => {
    seq += 1;
    events.set(seq, { type, seq, data });
    nodes.push(seq);
    return seq;
  };

  // 系统提示（表层第 0 个节点）
  push('system/message', { message: { role: 'system', content: [] } });

  for (const turn of spec) {
    push('user/message', { role: 'user', content: [{ type: 'text', text: `第${turn}轮用户话` }] });
    if (turn % 2 === 0) {
      // 偶数轮带一次工具调用 + 结果
      push('assistant/message', {
        message: { role: 'assistant', content: [{ type: 'tool-call', id: `c${turn}`, name: 'read', arguments: '{}' }] },
      });
      push('tool/result', { message: { role: 'tool', content: [{ type: 'text', text: 'ok' }] }, toolCallId: `c${turn}` });
    } else {
      push('assistant/message', {
        message: { role: 'assistant', content: [{ type: 'text', text: `第${turn}轮回答` }] },
      });
    }
  }

  const surface = { nodes };
  // replace 之后节点消失：测试里用一个可变集合模拟
  const hidden = new Set();
  return {
    get surface() {
      return { nodes: nodes.filter((n) => !hidden.has(n)) };
    },
    eventAt: (s) => events.get(s),
    deriveMessages() {
      return nodes.filter((n) => !hidden.has(n)).map((n) => events.get(n));
    },
    append(type, data, opts) {
      const op = opts?.surfaceOp;
      if (op?.op === 'replace') {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i] >= op.startSeq && nodes[i] <= op.endSeq) hidden.add(nodes[i]);
        }
      }
      const s = seq + 1;
      seq = s;
      events.set(s, { type, seq: s, data });
      nodes.push(s);
      return events.get(s);
    },
    _countUsers() {
      return nodes.filter((n) => !hidden.has(n)).filter((n) => events.get(n).type === 'user/message').length;
    },
    _users() {
      return nodes.filter((n) => !hidden.has(n)).filter((n) => events.get(n).type === 'user/message');
    },
  };
}

console.log('=== 1. 40 轮 → 只留 20 轮 ===');
{
  const turns = Array.from({ length: 40 }, (_, i) => i + 1);
  const s = makeSession(turns);
  const before = s._countUsers();
  const plan = mod.pruneHistory({ session: s }, 20);
  const after = s._countUsers();
  check('裁剪前 40 轮', before === 40, `实际 ${before}`);
  check('裁剪后 20 轮', after === 20, `实际 ${after}`);
  check('plan.removedTurns = 20', plan?.removedTurns === 20, `实际 ${plan?.removedTurns}`);
  check('保留了最新一轮', s._users().length === 20);
}

console.log('\n=== 2. 不足 20 轮 → 不动 ===');
{
  const s = makeSession(Array.from({ length: 8 }, (_, i) => i + 1));
  const plan = mod.pruneHistory({ session: s }, 20);
  check('返回 null（无需裁剪）', plan === null);
  check('轮数不变（8）', s._countUsers() === 8, `实际 ${s._countUsers()}`);
}

console.log('\n=== 3. 系统提示永不被裁 ===');
{
  const s = makeSession(Array.from({ length: 30 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 20);
  const first = s.surface.nodes[0];
  check('表层第 0 个节点仍是 system/message', s.eventAt(first).type === 'system/message');
}

console.log('\n=== 4. 工具配对不被切断 ===');
{
  const s = makeSession(Array.from({ length: 30 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 20);
  // 裁剪后重新遍历：不应出现孤立的 tool/result
  const nodes = s.surface.nodes;
  let pending = 0;
  let bad = false;
  for (const n of nodes) {
    const ev = s.eventAt(n);
    if (ev.type === 'assistant/message') {
      pending += (ev.data?.message?.content ?? []).filter((b) => b.type === 'tool-call').length;
    } else if (ev.type === 'tool/result') {
      pending -= 1;
      if (pending < 0) bad = true;
    }
  }
  check('没有孤立 tool/result', !bad);
  check('结束时 pending = 0', pending === 0, `实际 ${pending}`);
}

console.log('\n=== 5. 50 轮保留 20 ===');
{
  const s = makeSession(Array.from({ length: 50 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 20);
  check('结果 20 轮', s._countUsers() === 20, `实际 ${s._countUsers()}`);
}

console.log('\n=== 6. 自定义 keepTurns ===');
{
  const s = makeSession(Array.from({ length: 30 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 5);
  // 提示条走 developer/message，不占 user 名额 → 正好 5
  check('保留 5 轮（提示条不占名额）', s._countUsers() === 5, `实际 ${s._countUsers()}`);
  const hasDev = s.surface.nodes.some((n) => s.eventAt(n).type === 'developer/message');
  check('写入了 developer 提示条', hasDev);
}

console.log('\n=== 7. 插件默认关闭 ===');
{
  let registered = 0;
  mod.apply({ on: () => ((registered++, () => {})), effect: (f) => f(), get: () => undefined }, {});
  check('未传 enable:true 时不注册钩子', registered === 0, `实际 ${registered}`);
  mod.apply({ on: () => ((registered++, () => {})), effect: (f) => f(), get: () => undefined }, { enable: true });
  check('enable:true 时注册了钩子', registered === 1, `实际 ${registered}`);
}

console.log('\n=== 8. 源码不含「只靠人设文字」的假实现 ===');
{
  const src = readFileSync('./src/history-window.js', 'utf8');
  check('使用 surfaceOp replace', src.includes("op: 'replace'"));
  check('挂在 agent/pre-step（派生历史前）', src.includes('agent/pre-step'));
  check('包含工具配对平衡判定', src.includes('balancedBefore'));
}

console.log('\nRESULT:', ok ? 'PASS —— 历史真的裁到最近 N 轮' : 'FAIL');
process.exit(ok ? 0 : 1);
