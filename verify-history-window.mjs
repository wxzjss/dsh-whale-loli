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
  push('system/message', { message: { role: 'system', content: [], source: { kind: 'system' } } });

  for (const turn of spec) {
    // 真实用户开口：source.kind === 'user'
    push('user/message', { role: 'user', content: [{ type: 'text', text: `第${turn}轮用户话` }], source: { kind: 'user' } });
    // 隔一轮插一条宿主注入的运行时上下文（source.kind = 'runtime-context'）：
    // 它也是 user/message，但**不算一轮**，用来验证计数不被它带偏。
    if (turn % 3 === 0) {
      push('user/message', {
        role: 'user',
        content: [{ type: 'text', text: `（运行时上下文 #${turn}）` }],
        source: { kind: 'runtime-context' },
      });
    }
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
      // ── 复刻宿主 dsh-session-format-v3-to-v4 的**完整**消息校验 ──
      // 这些规则是一条条踩出来的，全部镜像进来，避免再出现「修一个冒一个」。
      const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
      const validSource = (m) =>
        isObj(m?.source) &&
        typeof m.source.kind === 'string' &&
        m.source.kind.length > 0 &&
        m.source.kind !== 'plugin';

      if (type === 'developer/message') {
        // assertV4DeveloperData + assertDeveloperMessage
        if (!isObj(data) || !isObj(data.message) || data.message.role !== 'developer') {
          violations.push('developer/message requires turn, step, and a developer message');
          throw new Error('developer/message requires turn, step, and a developer message');
        }
        for (const f of ['turn', 'step']) {
          if (!(Number.isInteger(data[f]) && data[f] > 0)) {
            violations.push(`developer/message ${f} must be positive`);
            throw new Error(`developer/message ${f} must be positive`);
          }
        }
        const m = data.message;
        if (
          typeof m.id !== 'string' ||
          m.id.length === 0 ||
          !Array.isArray(m.content) ||
          !validSource(m)
        ) {
          violations.push('developer message requires id, role, content, and a producer-owned source');
          throw new Error('developer message requires id, role, content, and a producer-owned source');
        }
      } else if (type === 'user/message') {
        // assertOrdinaryMessage + assertV4MessageSources
        if (isObj(data) && data.role === 'developer') {
          violations.push('developer/message and developer role must occur together');
          throw new Error('developer/message and developer role must occur together');
        }
        if (isObj(data) && data.content !== undefined && !Array.isArray(data.content)) {
          violations.push('user/message content must be an array');
          throw new Error('user/message content must be an array');
        }
        if (!validSource(data)) {
          violations.push('message requires a producer-owned source kind');
          throw new Error('message requires a producer-owned source kind');
        }
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
    /** 真正的用户轮数：排除本插件提示条与运行时上下文（与插件 isUserNode 同款判定）。 */
    _countUsers() {
      return this._users().length;
    },
    _users() {
      return nodes
        .filter((n) => !hidden.has(n))
        .filter((n) => {
          const e = events.get(n);
          if (e.type !== 'user/message') return false;
          const kind = e.data?.source?.kind;
          return kind !== 'history-window' && kind !== 'runtime-context';
        });
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
  const notice = s.surface.nodes.map((n) => s.eventAt(n)).find((e) => e.data?.source?.kind === 'history-window');
  check('写入了提示条（source.kind = history-window）', notice !== undefined);
  check('提示条是 user/message（宿主校验最宽松的合法形状）', notice?.type === 'user/message');
  check('提示条带 id', typeof notice?.data?.id === 'string' && notice.data.id.length > 0);
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

console.log('\n=== 10. 提示条必须合法、且不能被算成一轮 ===');
{
  // 宿主 dsh-session-format-v3-to-v4 对消息事件的完整要求已镜像进 mock：
  //   user/message     → role 不能是 developer、content 是数组、source.kind 非空且 ≠ 'plugin'
  //   developer/message → 还要 turn/step 正整数 + message.id + message.source
  // 之前用 developer/message 但没给 id/source，报
  //   format v4 developer message requires id, role, content, and a producer-owned source
  const s = makeSession(Array.from({ length: 40 }, (_, i) => i + 1));
  check('初始 40 轮', s._countUsers() === 40, `实际 ${s._countUsers()}`);
  check('初始含运行时上下文（不算轮）', s.surface.nodes.some((n) => s.eventAt(n).data?.source?.kind === 'runtime-context'));

  const plan = mod.pruneHistory({ session: s }, 20);
  check('裁剪成功', plan !== null);
  check('裁完正好 20 轮（提示条不占名额）', s._countUsers() === 20, `实际 ${s._countUsers()}`);
  check('全程零校验违规', s._violations.length === 0, s._violations.join(' | '));

  // 再裁一次：上一次的提示条本身会被新范围吃掉，不会越积越多
  const before = s._countUsers();
  mod.pruneHistory({ session: s }, 20);
  check('第二次裁剪不再变动（已是最新 20 轮）', s._countUsers() === before, `实际 ${s._countUsers()}`);
  const notices = s.surface.nodes.map((n) => s.eventAt(n)).filter((e) => e.data?.source?.kind === 'history-window');
  check('提示条最多一条（不会越积越多）', notices.length === 1, `实际 ${notices.length}`);
  check('第二次也无校验违规', s._violations.length === 0, s._violations.join(' | '));
}

console.log('\n=== 11. 写之前先自检：四种踩过的错误形状必须被拦下 ===');
{
  // 预检的意义：形状不对 → 跳过裁剪（对话继续），而不是写出去被宿主拒收（整回合死）。
  const good = {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    role: 'user',
    content: [{ type: 'text', text: '【已裁剪更早的对话】' }],
    source: { kind: 'history-window' },
  };
  check('合法形状 → 通过', mod.noticeIsValid(good) === true);

  const cases = [
    ['缺 id（0.5.3 真实踩到）', { ...good, id: undefined }],
    ['id 为空串', { ...good, id: '' }],
    ['缺 source（0.5.3 真实踩到）', { ...good, source: undefined }],
    ['source.kind 为空串', { ...good, source: { kind: '' } }],
    ['source.kind = plugin（宿主明令禁止）', { ...good, source: { kind: 'plugin' } }],
    ['source 不是对象', { ...good, source: 'history-window' }],
    ['role = developer（会触发 developer 校验）', { ...good, role: 'developer' }],
    ['content 不是数组', { ...good, content: 'text' }],
    ['整体不是对象', null],
    ['整体是数组', []],
  ];
  for (const [label, payload] of cases) {
    check(`拦下：${label}`, mod.noticeIsValid(payload) === false);
  }
}

console.log('\nRESULT:', ok ? 'PASS —— 历史裁到最近 N 轮，waterfall 放行，提示条通过本地预检' : 'FAIL');
process.exit(ok ? 0 : 1);
