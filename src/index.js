/**
 * dsh-whale-loli — 鲸鱼娘 Agent 预设（四个）
 *
 * 本包提供四个互不干扰的预设，各自带一份独立记忆文件：
 *
 *   · 鲸鱼娘Agent预设        persona.md              → <DSH_HOME>/whale-loli.md
 *   · 鲸鱼娘活人版Agent预设  persona-v2-live.md      → <DSH_HOME>/whale-loli-v2-live.md
 *   · 鲸鱼娘涩涩版Agent预设  persona-v3-naughty.md   → <DSH_HOME>/whale-loli-v3-naughty.md
 *   · 鲸鱼娘女儿版Agent预设  persona-v4-daughter.md  → <DSH_HOME>/dsh-whale-daughter.md
 *
 * 两件事都由 `cordis.patch.yml` 完成：
 *   1. 四条 `@deepseek-ai/dsh-agent-preset` 声明 —— 各自的 config 就是一个预设本体
 *      （id / name / description / order / plugins），被 `agentPresets.register()`
 *      注册后即出现在 Agent 预设界面。
 *   2. 每个预设里一条 `dsh-whale-loli` 行 —— 挂载本包 src/memory.js 的 whale-memory，
 *      把该预设自己的记忆文件注册成提示变量（读）、并注册对应的写入工具（写）。
 *
 * 记忆不串靠三层隔离：文件名不同、变量名不同、写入工具名不同 + 预设 scope 不同。
 *
 * 本文件同时导出预设元信息与人设正文，供构建 / 校验脚本复用。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply as applyMemory, inject as memoryInject, name as memoryName } from './memory.js';
import { apply as applyAffinity, name as affinityName } from './affinity.js';
import { apply as applyDaemon, inject as daemonInject } from './daemon.js';
import { AFFINITY_TOOLS, AFFINITY_VARIABLES, PRESETS } from './presets.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// 预设清单本身住在 `./presets.js`（daemon 也要读同一份，见那里的注释）。
export { AFFINITY_TOOLS, AFFINITY_VARIABLES, PRESETS, PRESET_IDS, presetById } from './presets.js';

/** 原版预设 id（兼容旧引用）。 */
export const PRESET_ID = PRESETS[0].id;

/** 原版预设显示名。 */
export const PRESET_NAME = PRESETS[0].name;

/** 活人版预设 id。 */
export const PRESET_ID_V2 = PRESETS[1].id;

/** 涩涩版预设 id。 */
export const PRESET_ID_V3 = PRESETS[2].id;

/** 女儿版预设 id。 */
export const PRESET_ID_V4 = PRESETS[3].id;

/** 原版预设说明。 */
export const PRESET_DESCRIPTION = PRESETS[0].description;

/** 活人版预设说明。 */
export const PRESET_DESCRIPTION_V2 = PRESETS[1].description;

/** 涩涩版预设说明。 */
export const PRESET_DESCRIPTION_V3 = PRESETS[2].description;

/** 女儿版预设说明。 */
export const PRESET_DESCRIPTION_V4 = PRESETS[3].description;

/** 原版人设正文（persona.md）。 */
export const personaText = read('./persona.md');

/** 活人版人设正文（persona-v2-live.md）。 */
export const personaTextV2 = read('./persona-v2-live.md');

/** 涩涩版人设正文（persona-v3-naughty.md）。 */
export const personaTextV3 = read('./persona-v3-naughty.md');

/** 女儿版人设正文（persona-v4-daughter.md）。 */
export const personaTextV4 = read('./persona-v4-daughter.md');

/** 按预设 id 取人设正文 —— 校验脚本用它避免复制粘贴式三元表达式。 */
export function personaTextOf(presetId) {
  const p = PRESETS.find((x) => x.id === presetId);
  if (!p) throw new Error('unknown preset id: ' + presetId);
  return read(p.personaFile);
}

export {
  memoryPath,
  readMemory,
  ensureMemoryFile,
  memorySectionText,
  parseMemory,
  composeMemory,
  renderMemory,
  pruneMemoryFile,
  appendRolling,
  nextTurnId,
  archiveDir,
  memoryStem,
  memoryTemplate,
  FIXED_SECTIONS,
  DEFAULT_MEMORY_FILE,
  DEFAULT_VARIABLE,
  MEMORY_SECTION,
  MEMORY_MAX_CHARS,
  DEFAULT_TURN_LIMIT,
  DEFAULT_DETAIL_LIMIT,
  ZONE_FIXED,
  ZONE_ROLL,
  ZONE_DETAIL,
  ZONE_ARCHIVE,
} from './memory.js';

/** 本插件在宿主组合里的行为：挂载记忆行（file / variableName / toolName 由预设各自传入）。 */
function apply(ctx, config = {}) {
  return applyMemory(ctx, config);
}

/**
 * 宿主级那一行（`config.daemon: true`）挂的是好感度守护进程。
 *
 * 为什么非要挤进默认导出：宿主的 client-modules 只会扫描 `ctx.loader.entries()`
 * 里那些 **specifier 本身能被解析成包** 的行（`exactPackageSpecifier` 只认
 * 不带斜杠的裸名，或用 `createRequire().resolve('<spec>/package.json')` 能解到的
 * subpath）。我们的 daemon 原先写成 `name: 'dsh-whale-loli/affinity-daemon'`，
 * 而 `dsh-whale-loli/affinity-daemon/package.json` 解析不到
 * （`ERR_PACKAGE_PATH_NOT_EXPORTED`），于是 `dsh.client` 永远不被发现，
 * 「设置 → 好感度」那一栏也就永远不出现。
 *
 * 而预设里的那几行 `dsh-whale-loli` 又不在宿主根 Loader 的 entries 里
 * （它们在预设自己的 scope 里），同样扫不到。
 *
 * 所以让宿主级那一行直接用裸包名 `dsh-whale-loli`，靠 `config.daemon` 分派到
 * daemon —— 这样 specifier 解析得动，manifest 带 `dsh.client`，客户端被挂上。
 */
function applyEntry(ctx, config = {}) {
  if (config?.daemon === true) return applyDaemon(ctx, config);
  // 好感度行必须自己分派出去。
  //
  // 事故（0.9.10 及以前）：所有行都用裸包名 `dsh-whale-loli`（client 发现机制要求，
  // 见上面那段注释），而这里只判断了 `daemon`，于是 4 条 `whale-affinity` 行全部
  // 落进 `applyMemory()`。记忆插件不认识 scope，`config.file` 缺失就退回默认的
  // `whale-loli.md` —— 结果：
  //   · `{{affinity_v1}}` 里注入的是**记忆文件正文**（人设的好感度段变成第二份记忆）；
  //   · 每个预设多出一个把摘要写进 whale-loli.md 的 `affinity_vN_set` 工具（工具串台）。
  // 现在按 `config.row` 显式分派，并保留形状兜底（有 scope、没 file ⇒ 好感度行）。
  if (config?.row === 'affinity' || (config?.scope !== undefined && config?.file === undefined)) {
    return applyAffinity(ctx, config);
  }
  return applyMemory(ctx, config);
}

/** 好感度行（scope / variableName / toolName / commandName 由预设各自传入）。 */
function applyAffinityRow(ctx, config = {}) {
  return applyAffinity(ctx, config);
}

export default {
  name: 'dsh-whale-loli',
  // 注意：`inject` 是静态声明，只能写作用域里**一直存在**的服务名。
  // 千万别把不存在的服务名写进来 —— 宿主会一直等它，结果是**所有**预设
  // 都挂在 `agent-preset/invalid` 上加载失败，而且报错只提插件名不提字段，
  // 极难定位。
  //
  // 这一行是「记忆行」和「宿主级 daemon 行」**共用**的，两边都得能起来。
  // memory 只要 systemPrompt（预设里必然存在）；daemon 现在声明为空
  // （只用 ctx.provide / ctx.get / ctx.reflect，全是 cordis 内建）。
  // 曾经 daemon 声明了 ['reflect','typert']，于是宿主那一行永远 waiting for
  // typert、apply() 从不执行，设置页只报「远程方法未挂载」。
  inject: [...new Set([...memoryInject, ...daemonInject])],
  apply: applyEntry,
};

// 让 `whale-memory` 也能作为本包的一个入口被挂载（patch 里用的是这个名字）。
export { apply as whaleMemoryApply, memoryName };

// 让 `whale-affinity` 也能作为本包的一个入口被挂载（patch 里用的是这个名字）。
export { apply as whaleAffinityApply, affinityName, applyAffinityRow };

export {
  MIN_AFFINITY,
  MAX_AFFINITY,
  DEFAULT_AFFINITY,
  BANDS,
  bandOf,
  clampAffinity,
  readAffinity,
  writeAffinity,
  affinityPath,
  affinityDir,
  renderAffinity,
} from './affinity.js';
