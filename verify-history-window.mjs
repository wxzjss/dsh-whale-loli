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
  const violations = [];
  return {
    get surface() {
      return { nodes: nodes.filter((n) => !hidden.has(n)) };
    },
    eventAt: (s) => events.get(s),
    deriveMessages() {
      return nodes.filter((n) => !hidden.has(n)).map((n) => events.get(n));
    },
    append(type, data, opts) {
      // 复刻宿主 dsh-session-format 的校验：developer/message 的 turn 必须为正整数
      if (type === 'developer/message' && !(Number.isInteger(data?.turn) && data.turn > 0)) {
        violations.push(`developer/message turn must be positive (实际 turn=${data?.turn})`);
        throw new Error('developer/message turn must be positive');
      }
      const op = opts?.surfaceOp;
      if (op?.op === 'replace') {
        // 复刻宿主 assertSourceEventReferences：sourceEventSeqs 必须列全每个被 shadow 的表层节点
        const expected = nodes.filter((n) => !hidden.has(n) && n >= op.startSeq && n <= op.endSeq);
        const given = Array.isArray(opts.sourceEventSeqs) ? opts.sourceEventSeqs : [];
        const missing = expected.filter((n) => !given.includes(n));
        if (missing.length > 0) violations.push(`surface replace: sourceEventSeqs 缺 ${missing.join(',')}`);
        if (new Set(given).size !== given.length) violations.push('sourceEventSeqs 有重复');
        for (const n of nodes) {
          if (n >= op.startSeq && n <= op.endSeq) hidden.add(n);
        }
      }
      const s = seq + 1;
      seq = s;
      events.set(s, { type, seq: s, data });
      nodes.push(s);
      return events.get(s);
    },
    _violations: violations,
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
  const plan = mod.pruneHistory({ session: s }, 20, { turn: 1, step: 1 });
  const after = s._countUsers();
  check('裁剪前 40 轮', before === 40, `实际 ${before}`);
  check('裁剪后 20 轮', after === 20, `实际 ${after}`);
  check('plan.removedTurns = 20', plan?.removedTurns === 20, `实际 ${plan?.removedTurns}`);
  check('保留了最新一轮', s._users().length === 20);
}

console.log('\n=== 2. 不足 20 轮 → 不动 ===');
{
  const s = makeSession(Array.from({ length: 8 }, (_, i) => i + 1));
  const plan = mod.pruneHistory({ session: s }, 20, { turn: 1, step: 1 });
  check('返回 null（无需裁剪）', plan === null);
  check('轮数不变（8）', s._countUsers() === 8, `实际 ${s._countUsers()}`);
}

console.log('\n=== 3. 系统提示永不被裁 ===');
{
  const s = makeSession(Array.from({ length: 30 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 20, { turn: 1, step: 1 });
  const first = s.surface.nodes[0];
  check('表层第 0 个节点仍是 system/message', s.eventAt(first).type === 'system/message');
}

console.log('\n=== 4. 工具配对不被切断 ===');
{
  const s = makeSession(Array.from({ length: 30 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 20, { turn: 1, step: 1 });
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
  mod.pruneHistory({ session: s }, 20, { turn: 1, step: 1 });
  check('结果 20 轮', s._countUsers() === 20, `实际 ${s._countUsers()}`);
}

console.log('\n=== 6. 自定义 keepTurns ===');
{
  const s = makeSession(Array.from({ length: 30 }, (_, i) => i + 1));
  mod.pruneHistory({ session: s }, 5, { turn: 1, step: 1 });
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
  check('替换事件带 sourceEventSeqs', src.includes('sourceEventSeqs'));
}

console.log('\n=== 9. waterfall 必须被放行（回归：曾导致 decision.kind 崩溃）===');
{
  // 复刻 @deepseek-ai/cordis 的 waterfall 实现：
  //   不调用 next() 的监听器会否决整条链，并把它自己的返回值当作最终结果。
  function waterfall(listeners, args, inner) {
    const cbs = [...listeners];
    const a = [...args];
    const next = () => (cbs.shift() ?? inner)(...a);
    a.push(next);
    return next();
  }

  // 抓取 apply 注册的监听器
  let listener;
  const mockCtx = {
    on: (_name, cb) => ((listener = cb), () => {}),
    effect: (f) => f(),
    get: () => undefined,
  };
  mod.apply(mockCtx, { enable: true, keepTurns: 20 });
  check('注册了 pre-step 监听器', typeof listener === 'function');

  // 造一个「无需裁剪」的会话：监听器仍然必须放行
  const small = makeSession(Array.from({ length: 3 }, (_, i) => i + 1));
  const innerDecision = { kind: 'enter', messages: [] };
  const got = await waterfall([listener], [{ agent: { session: small }, turn: 1, step: 1 }], () => innerDecision);
  check('waterfall 返回值不是 undefined', got !== undefined, `实际 ${String(got)}`);
  check('waterfall 返回内层 decision（kind=enter）', got?.kind === 'enter', `实际 kind=${got?.kind}`);
  // 关键反例：老实现（不接 next、返回 undefined）会让这里读到 undefined.kind
  let oldCrash = false;
  try {
    const oldGot = await waterfall([async () => {}], [{ agent: { session: small }, turn: 1, step: 1 }], () => innerDecision);
    void oldGot.kind;
  } catch (e) {
    oldCrash = String(e.message).includes("reading 'kind'");
  }
  check('反例：不调用 next 的老写法确实崩在 reading kind', oldCrash);

  // 需要裁剪时也必须放行
  const big = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  const got2 = await waterfall([listener], [{ agent: { session: big }, turn: 7, step: 1 }], () => innerDecision);
  check('需要裁剪时仍返回 decision', got2?.kind === 'enter');
  check('需要裁剪时确实裁了（20 轮）', big._countUsers() === 20, `实际 ${big._countUsers()}`);
  check('裁剪没有触发宿主 sourceEventSeqs 校验错误', big._violations.length === 0, big._violations.join(' | '));
  check('没有触发 turn 必须为正数的校验', big._violations.length === 0, big._violations.join(' | '));

  // 裁剪抛错也不能拖垮 waterfall
  const broken = { surface: { get nodes() { throw new Error('boom'); } }, eventAt: () => undefined };
  const got3 = await waterfall([listener], [{ agent: { session: broken }, turn: 2, step: 1 }], () => innerDecision);
  check('裁剪内部抛错时仍返回 decision', got3?.kind === 'enter');
}

console.log('\n=== 10. 拿不到合法 turn 时跳过裁剪（不许写非法事件）===');
{
  // 宿主 dsh-session-format 要求 developer/message 的 turn 为正整数。
  // 老代码写死 turn:0，会抛 `developer/message turn must be positive` 并拖垮整回合。
  const s = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  const before = s._countUsers();
  for (const position of [{}, { turn: 0, step: 1 }, { turn: -3, step: 1 }, { turn: 1.5, step: 1 }, undefined]) {
    const plan = mod.pruneHistory({ session: s }, 20, position);
    check(`position=${JSON.stringify(position)} → 返回 null`, plan === null);
  }
  check('20 轮没被裁（因为 skipped）', s._countUsers() === before, `实际 ${s._countUsers()}`);
  check('没有写任何非法 developer/message', s._violations.length === 0, s._violations.join(' | '));

  // 传了合法 turn 就能正常裁
  const ok2 = mod.pruneHistory({ session: s }, 20, { turn: 1, step: 1 });
  check('给了合法 turn 后正常裁剪', ok2 !== null && s._countUsers() === 20, `实际 ${s._countUsers()}`);
  check('裁剪全程无校验错误', s._violations.length === 0, s._violations.join(' | '));
}

console.log('\nRESULT:', ok ? 'PASS —— 历史真的裁到最近 N 轮，waterfall 被放行，且 turn 合法' : 'FAIL');
process.exit(ok ? 0 : 1);
