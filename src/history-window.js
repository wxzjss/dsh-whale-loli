/**
 * history-window —— 把会话历史真的裁到「最近 N 轮」。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 *
 * 只在人设里写「每轮先看最近 20 轮」是**空话**：宿主不会因为那句话就不发旧消息。
 * 实测（本机最长会话）33 轮 / 85 条 user 消息 / 1565 条 tool 结果，全部发给模型；
 * 宿主自带的 compaction 只在 token 压力超阈值时才压，粒度是「保留一段 token 尾巴」，
 * 不是轮数。
 *
 * 本模块用宿主自己的表层替换机制（compaction 用的是同一套）做**纯删除**：
 *
 *     session.append('user/message', 提示条, {
 *       surfaceOp: { op: 'replace', startSeq, endSeq },
 *     })
 *
 * 被 replace 覆盖的表层节点从 `deriveMessages()` 里消失 —— 模型真的收不到它们，
 * 但会话日志仍然留着（可回溯、不丢数据）。**不调 LLM、不花 token、不生成摘要。**
 *
 * ── 三条安全线 ────────────────────────────────────────────────────────
 *
 * 1. **工具配对不能切断**：切点必须落在「没有未回应的 tool-call」的位置，
 *    否则模型会看到孤立的 tool 结果而报错。这里复用与 compaction 同款的平衡判定
 *    （遍历当前表层、累计 in-progress tool-call 数为 0 才允许切）。
 * 2. **system prompt 不能裁**：表层第 0 个节点是系统提示，永不进入裁剪范围。
 * 3. **默认关闭**：改写会话历史是强动作，必须显式 `enable: true`。
 *
 * ── 挂在哪里 ──────────────────────────────────────────────────────────
 *
 * `agent/pre-step`：循环在每个步骤**派生历史之前**运行它，是唯一既在请求前、
 * 又能拿到本 agent 的时机。（`turn/start` 是 session 事件而非 ctx 事件，挂不上。）
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cordis 插件名。 */
export const name = 'whale-history-window';

/** 需要会话存储与 agent 注册表。 */
export const inject = ['sessions'];

/** 默认保留轮数。 */
export const DEFAULT_KEEP_TURNS = 20;

/** 被裁掉时写进历史的那条提示（模型唯一能看到的痕迹）。 */
export function noticeText(removedTurns, keptTurns) {
  return (
    `【已裁剪更早的对话】为了只保留最近 ${keptTurns} 轮，` +
    `${removedTurns} 轮更早的对话已从上下文中移除（仍保存在会话日志里，可回溯）。` +
    `结合小鱼自己的记忆文件继续就好。`
  );
}

/** dsh 家目录。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/**
 * 本插件写进会话的「已裁剪」提示条所用的 source.kind。
 * 宿主只要求 message.source.kind 是非空字符串且不是 `'plugin'`，
 * 但我们必须能把自己的提示条和「真实用户开口」区分开，否则每裁一次就多算一轮。
 */
export const NOTICE_SOURCE_KIND = 'history-window';

/** 不算「用户开口」的 source.kind：本插件的提示条 + 宿主注入的运行时上下文。 */
const NON_TURN_SOURCE_KINDS = new Set([NOTICE_SOURCE_KIND, 'runtime-context']);

/**
 * 一个「轮」的边界 = 一条**真实用户**发出的 user 消息。
 *
 * 不能只看 `type === 'user/message'`：宿主的运行时上下文（`source.kind = 'runtime-context'`）
 * 和本插件自己的提示条也是 user/message，会把轮数算多、导致过早裁剪。
 * 来源未知（老日志没有 source）时保守地当成用户开口。
 */
function isUserNode(event) {
  if (event?.type !== 'user/message') return false;
  const kind = event.data?.source?.kind;
  return typeof kind !== 'string' || !NON_TURN_SOURCE_KINDS.has(kind);
}

/**
 * 切点之前是否工具配对平衡（没有未回应的 tool-call 跨过切点）。
 * 与 `@deepseek-ai/dsh-compaction` 的 tool-pairing 同款判定。
 */
export function balancedBefore(session, nodes, cutIndex) {
  let pending = 0;
  for (let i = 0; i < cutIndex; i++) {
    const ev = session.eventAt(nodes[i]);
    if (ev === undefined) return false;
    if (ev.type === 'assistant/message') {
      pending += (ev.data?.message?.content ?? []).filter((b) => b.type === 'tool-call').length;
    } else if (ev.type === 'tool/result') {
      pending -= 1;
      if (pending < 0) return false;
    }
  }
  return pending === 0;
}

/**
 * 计算裁剪计划（纯函数，不写会话）。
 *
 * @param session - 需要 `surface.nodes` 与 `eventAt()`。
 * @param keepTurns - 保留最近多少轮。
 * @returns `{ startSeq, endSeq, removedTurns, keptTurns, cutIndex }`，无需裁剪返回 null。
 */
export function planPrune(session, keepTurns = DEFAULT_KEEP_TURNS) {
  const nodes = session?.surface?.nodes ?? [];
  if (nodes.length === 0) return null;

  // 系统提示所在位置：表层里第一个 system/message 节点。它和它之前的节点永不裁剪。
  let firstUser = 0;
  for (let i = 0; i < nodes.length; i++) {
    if (session.eventAt(nodes[i])?.type === 'user/message') {
      firstUser = i;
      break;
    }
  }

  const userIdx = [];
  for (let i = 0; i < nodes.length; i++) {
    if (isUserNode(session.eventAt(nodes[i]))) userIdx.push(i);
  }
  if (userIdx.length <= keepTurns) return null;

  // 保留最近 keepTurns 个 user 轮（提示条走 developer/message，不占 user 名额）
  if (userIdx.length <= keepTurns) return null;

  let cut = userIdx[userIdx.length - keepTurns];
  while (cut > firstUser && !balancedBefore(session, nodes, cut)) cut--;
  if (cut <= firstUser) return null;

  // 关键：startSeq 必须是第一个 user 节点，**绝不能是 nodes[0]**，
  // 否则表层第 0 个 system/message 会被一起 replace 掉。
  return {
    startSeq: nodes[firstUser],
    endSeq: nodes[cut - 1],
    removedTurns: userIdx.length - keepTurns,
    keptTurns: keepTurns,
    cutIndex: cut,
  };
}

/**
 * 收集被替换范围覆盖的**当前表层节点**。
 *
 * 宿主的 `assertSourceEventReferences` 硬性要求：`sourceEventSeqs` 必须列全每一个
 * 被 shadow 的表层节点，否则抛
 *   `surface replace: sourceEventSeqs must include every shadowed surface node; missing …`
 * 漏了这个参数 = 每次裁剪都失败（错误又被 try/catch 吞掉，表现为「裁剪从来没生效」）。
 */
export function shadowedNodes(session, startSeq, endSeq) {
  const nodes = session?.surface?.nodes ?? [];
  return nodes.filter((seq) => seq >= startSeq && seq <= endSeq);
}

/** 提示条事件的唯一构造点。 */
function noticePayload(plan) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: noticeText(plan.removedTurns, plan.keptTurns) }],
    source: { kind: NOTICE_SOURCE_KIND },
  };
}

/**
 * 本地预检：把宿主 `dsh-session-format-v3-to-v4` 的规则在**写之前**自己先跑一遍。
 *
 * 为什么需要：连踩四次都是「写出去才被宿主拒收」，而拒收会直接打死整个回合
 * （`turn/end {kind:'error'}`），用户看到的就是一句看不懂的校验错误。预检之后，
 * 形状不对只会让我们**跳过这次裁剪**，对话继续。
 *
 * 校验项（对 `user/message`）：
 *   1. `assertOrdinaryMessage` —— `role !== 'developer'`、`content` 必须是数组
 *   2. `assertV4MessageSources` —— `source` 是对象、`source.kind` 非空且 ≠ `'plugin'`
 *   3. 本插件额外要求 `id` 非空（真实消息都有，便于溯源）
 */
export function noticeIsValid(message) {
  const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(message)) return false;
  if (typeof message.id !== 'string' || message.id.length === 0) return false;
  if (message.role === 'developer') return false;
  if (!Array.isArray(message.content)) return false;
  const source = message.source;
  if (!isObject(source)) return false;
  if (typeof source.kind !== 'string' || source.kind.length === 0) return false;
  if (source.kind === 'plugin') return false;
  return true;
}

/**
 * 执行裁剪。返回计划；无需裁剪返回 null。
 *
 * 替换消息用 **`user/message`**，形状照 compaction 的 checkpoint 抄 —— 这是宿主
 * 已经在跑、必然通过全部校验的那条路径。相比之下 `developer/message` 的规则苛刻得多
 * （`assertDeveloperMessage` 要求 `id` / `role` / `content` / **producer-owned `source`**，
 * 且 `turn`、`step` 必须是正整数），少一项就抛：
 *   format v4 developer message requires id, role, content, and a producer-owned source
 *
 * `user/message` 这边只有两条硬要求：
 *   1. `assertOrdinaryMessage`：`role !== 'developer'`、`content` 是数组
 *   2. `assertV4MessageSources`：`source.kind` 是非空字符串且不等于 `'plugin'`
 * 所以带上 `id` 和 `source: { kind: 'history-window' }` 即可，且能被 {@link isUserNode}
 * 识别出来、不计入轮数。
 */
export function pruneHistory(agent, keepTurns = DEFAULT_KEEP_TURNS) {
  const session = agent?.session;
  if (session === undefined) return null;

  const plan = planPrune(session, keepTurns);
  if (plan === null) return null;

  const shadowed = shadowedNodes(session, plan.startSeq, plan.endSeq);
  if (shadowed.length === 0) return null;

  const message = noticePayload(plan);
  // 预检不过就跳过：宁可这次不裁，也不写一个会被宿主拒收、拖垮整回合的事件。
  if (!noticeIsValid(message)) return null;

  session.append(
    'user/message',
    message,
    {
      surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq },
      sourceEventSeqs: shadowed,
    },
  );
  return plan;
}

/**
 * 挂载：每个步骤派生历史之前检查并裁剪。
 *
 * ⚠️ `agent/pre-step` 是 Cordis 的 **waterfall**。宿主实现：
 *
 *     waterfall(...args) {
 *       const cbs = this.dispatch("waterfall", args)
 *       const inner = args.pop()
 *       const next = () => (cbs.shift() ?? inner)(...args)
 *       args.push(next)
 *       return next()
 *     }
 *
 * 也就是说：**不调用 `next()` 的监听器会否决整条链**，并把它自己的返回值当作最终结果。
 * 曾经这里写成 `async (payload) => { …裁剪… }`（不接 next、返回 undefined），结果
 * `agent/pre-step` 的 decision 变成 undefined，agent-loop 里 `decision.kind` 直接抛
 *   `Cannot read properties of undefined (reading 'kind')`
 * —— 整个回合在 step 之前就崩掉，而且没有任何 step/start 事件，极难定位。
 *
 * 所以：无论裁剪成功、失败还是被跳过，**必须 `return next()`**，把下游的行为（默认的
 * `{kind:'enter'}` 以及 compaction 等其它监听器）原样放行。
 *
 * config：
 *   - `enable`    置 true 才真的裁（默认 false —— 改写历史是强动作）
 *   - `keepTurns` 保留最近多少轮（默认 20）
 */
export function apply(ctx, config = {}) {
  if (config.enable !== true) return;

  const keepTurns = typeof config.keepTurns === 'number' ? config.keepTurns : DEFAULT_KEEP_TURNS;

  // agent/pre-step 在派生历史之前运行，且拿得到本 agent。
  ctx.effect(
    () =>
      ctx.on('agent/pre-step', async (payload, next) => {
        try {
          const agent = payload?.agent ?? payload?.handle?.agent;
          if (agent?.session !== undefined) pruneHistory(agent, keepTurns);
        } catch {
          // 裁剪失败绝不影响正常对话
        }
        // 必须放行 waterfall：绝不吞掉 decision，否则下游读 decision.kind 会崩。
        return next();
      }),
    'whale-history-window.pre-step',
  );
}

/** 窗口配置（给文档/自检用）。 */
export function windowConfig() {
  return { defaultKeepTurns: DEFAULT_KEEP_TURNS, marker: join(dshHome(), 'whale-history-window.json') };
}

export default { name, inject, apply };
