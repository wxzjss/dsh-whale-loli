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

/** 一个「轮」的边界 = 一条 user 消息。表层里只有消息节点，turn 标记不进表层。 */
function isUserNode(event) {
  return event?.type === 'user/message';
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

/** 执行裁剪。返回计划；无需裁剪返回 null。 */
export function pruneHistory(agent, keepTurns = DEFAULT_KEEP_TURNS) {
  const session = agent?.session;
  if (session === undefined) return null;
  const plan = planPrune(session, keepTurns);
  if (plan === null) return null;

  session.append(
    'developer/message',
    {
      turn: 0,
      step: 0,
      message: {
        role: 'developer',
        content: [{ type: 'text', text: noticeText(plan.removedTurns, plan.keptTurns) }],
      },
    },
    { surfaceOp: { op: 'replace', startSeq: plan.startSeq, endSeq: plan.endSeq } },
  );
  return plan;
}

/**
 * 挂载：每个步骤派生历史之前检查并裁剪。
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
      ctx.on('agent/pre-step', async (payload) => {
        const agent = payload?.agent ?? payload?.handle?.agent ?? ctx.get('agents')?.currentInitiator();
        if (agent?.session === undefined) return;
        try {
          pruneHistory(agent, keepTurns);
        } catch {
          // 裁剪失败绝不影响正常对话
        }
      }),
    'whale-history-window.pre-step',
  );
}

/** 窗口配置（给文档/自检用）。 */
export function windowConfig() {
  return { defaultKeepTurns: DEFAULT_KEEP_TURNS, marker: join(dshHome(), 'whale-history-window.json') };
}

export default { name, inject, apply };
