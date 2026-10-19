/**
 * history-window —— 让「最近 N 轮」以外的内容**不计入输入**。
 *
 * ── 为什么是这个做法 ──────────────────────────────────────────────────
 *
 * 之前试过自己往会话里写替换事件（`surfaceOp: replace`）来做纯删除，连崩四次：
 * `dsh-session-format-v3-to-v4` 的校验器对消息事件极其苛刻 ——
 * 先要求 `developer/message` 的 turn 为正整数，再要求 `id`/`role`/`content`/
 * producer-owned `source`，改 `user/message` 也照样被拒；而一旦被拒就是**整个回合失败**。
 * 换句话说：**事件形状不是插件该自己拼的东西**。
 *
 * 现在改成调用宿主自己的压缩服务：
 *
 *     ctx.compaction.compactRegion(start, end, agent, signal)
 *
 * 它把 `[start, end]` 这段表层节点**替换成一条摘要**（由宿主写事件、宿主校验），
 * 于是原始旧消息真的不再计入输入，只有那条摘要计入。切点仍然由我算（保留最近 N 轮），
 * 但合法性判断与写入全部交给宿主。
 *
 * ── 代价与边界 ────────────────────────────────────────────────────────
 *
 * · 每次裁剪会跑**一次摘要 LLM 调用**（宿主用当前路由模型）。
 * · 只能在 agent 空闲时做（压缩服务拒绝 active 会话），所以挂在 `agent/status === 'idle'`。
 * · 裁完轮数会掉到 N 上下，必须等到再次超过 N 才会触发 —— 天然限流，不会每轮都调。
 * · 任何失败都被吞掉并跳过本次，**绝不影响正常对话**。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Cordis 插件名。 */
export const name = 'whale-history-window';

/** 需要会话表（用来拿 agent.session）。 */
export const inject = ['sessions'];

/** 默认保留轮数。 */
export const DEFAULT_KEEP_TURNS = 20;

/** 不算「用户开口」的 source.kind：宿主注入的运行时上下文。 */
const NON_TURN_SOURCE_KINDS = new Set(['runtime-context']);

/** dsh 家目录（仅用于自检输出）。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/**
 * 一条事件算不算「用户开口」。
 *
 * 不能只看 `type === 'user/message'`：宿主的运行时上下文（`source.kind = 'runtime-context'`）
 * 也是 user/message，会把轮数算多、导致过早压缩。来源未知时保守地算作一轮。
 */
export function isUserTurn(event) {
  if (event?.type !== 'user/message') return false;
  const kind = event.data?.source?.kind;
  return typeof kind !== 'string' || !NON_TURN_SOURCE_KINDS.has(kind);
}

/**
 * 切点之前是否工具配对平衡（没有未回应的 tool-call 跨过切点）。
 * 压缩服务要求两端都平衡，否则拒绝该范围。
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
 * 计算压缩范围（纯函数，不动会话）。
 *
 * @param session - 需要 `surface.nodes` 与 `eventAt()`。
 * @param keepTurns - 保留最近多少轮。
 * @returns `{ startSeq, endSeq, removedTurns, keptTurns }`；无需压缩返回 null。
 */
export function planCompact(session, keepTurns = DEFAULT_KEEP_TURNS) {
  const nodes = session?.surface?.nodes ?? [];
  if (nodes.length === 0) return null;

  // 表层第一个 user 节点：系统提示（节点 0）永不进入范围
  let firstTurn = -1;
  for (let i = 0; i < nodes.length; i++) {
    if (session.eventAt(nodes[i])?.type === 'user/message') {
      firstTurn = i;
      break;
    }
  }
  if (firstTurn < 0) return null;

  const turnIdx = [];
  for (let i = firstTurn; i < nodes.length; i++) {
    if (isUserTurn(session.eventAt(nodes[i]))) turnIdx.push(i);
  }
  if (turnIdx.length <= keepTurns) return null;

  // 保留最近 keepTurns 轮：切点 = 第 (总数 - keepTurns) 个用户轮
  let cut = turnIdx[turnIdx.length - keepTurns];
  // 往前挪到最近的工具配对平衡位置
  while (cut > firstTurn && !balancedBefore(session, nodes, cut)) cut--;
  if (cut <= firstTurn) return null;

  return {
    startSeq: nodes[firstTurn],
    endSeq: nodes[cut - 1],
    removedTurns: turnIdx.length - keepTurns,
    keptTurns: keepTurns,
  };
}

/**
 * 执行压缩。成功返回计划，跳过返回 null。
 *
 * 真正的替换由 `ctx.compaction.compactRegion()` 完成：它负责摘要、写事件、写日志。
 * 本函数只负责「算范围」和「不让异常外泄」。
 */
export async function compactHistory(ctx, agent, keepTurns = DEFAULT_KEEP_TURNS, signal) {
  const session = agent?.session;
  if (session === undefined) return null;

  const compaction = ctx.get?.('compaction') ?? ctx.compaction;
  if (compaction?.compactRegion === undefined) return null;

  const plan = planCompact(session, keepTurns);
  if (plan === null) return null;

  await compaction.compactRegion(plan.startSeq, plan.endSeq, agent, signal);
  return plan;
}

/** 每个 agent 同时只允许一次压缩（压缩服务本身也拒绝并发，这里提前避开）。 */
const inFlight = new WeakSet();

/**
 * 挂载：agent 转为空闲时检查轮数，超过 keepTurns 就压缩掉更早的部分。
 *
 * config：
 *   - `enable`    置 false 完全不挂（默认**开启**；出问题一行改回）
 *   - `keepTurns` 保留最近多少轮（默认 20）
 */
export function apply(ctx, config = {}) {
  if (config.enable === false) return;

  const keepTurns = typeof config.keepTurns === 'number' ? config.keepTurns : DEFAULT_KEEP_TURNS;
  if (typeof ctx.on !== 'function') return;

  ctx.effect(
    () =>
      ctx.on('agent/status', (payload) => {
        if (payload?.status !== 'idle') return;
        const agent = payload?.agent;
        if (agent?.session === undefined) return;
        if (inFlight.has(agent)) return;
        inFlight.add(agent);
        // 不 await：这是空闲期的后台整理，绝不能拖住/影响对话。
        void Promise.resolve()
          .then(() => compactHistory(ctx, agent, keepTurns))
          .catch(() => {})
          .finally(() => inFlight.delete(agent));
      }),
    'whale-history-window.idle-compact',
  );
}

/** 给文档/自检用的配置快照。 */
export function windowConfig() {
  return { defaultKeepTurns: DEFAULT_KEEP_TURNS, home: dshHome() };
}

export default { name, inject, apply };
