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
 * 全靠 `cordis.patch.yml` 完成：
 *   1. 四条 `@deepseek-ai/dsh-agent-preset` 声明 —— 各自的 config 就是一个预设本体
 *      （id / name / description / order / plugins），被 `agentPresets.register()`
 *      注册后即出现在 Agent 预设界面。
 *   2. 每个预设里一条 `dsh-whale-loli` 行 —— 挂载本包 src/memory.js 的 whale-memory，
 *      把该预设自己的记忆文件注册成提示变量（读）、并注册对应的写入工具（写）。
 *
 * 记忆不串靠三层隔离：文件名不同、变量名不同、写入工具名不同 + 预设 scope 不同。
 *
 * 好感度（affinity）已于 0.9.16 整体移除，见文件末尾的说明。
 *
 * 本文件同时导出预设元信息与人设正文，供构建 / 校验脚本复用。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply as applyMemory, inject as memoryInject, name as memoryName } from './memory.js';
import { PRESETS } from './presets.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

// 预设清单本身住在 `./presets.js`。
export { PRESETS, PRESET_IDS, presetById } from './presets.js';

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

/**
 * 本插件在宿主组合里的行为：挂载记忆行（file / variableName / toolName 由预设各自传入）。
 *
 * ⚠️ 分派注意：patch 里所有挂载行都用**裸包名** `dsh-whale-loli`（宿主 client-modules
 * 的 `locatePkgJson` 只认裸名，见旧版本注释），所以每一行都会进到这里。
 * 现在只剩记忆行一种，直接转 `applyMemory` 即可；`config.row` 保留在 patch 里
 * 作为显式标记，将来再加新的行类型时必须在这里按 `config.row` 分派 ——
 * 0.9.10 就是漏了分派，4 条好感度行全落进记忆模块，导致 `{{affinity_vN}}`
 * 被注入记忆文件正文。
 */
function applyEntry(ctx, config = {}) {
  return applyMemory(ctx, config);
}

export default {
  name: 'dsh-whale-loli',
  // 注意：`inject` 是静态声明，只能写作用域里**一直存在**的服务名。
  // 千万别把不存在的服务名写进来 —— 宿主会一直等它，结果是**所有**预设
  // 都挂在 `agent-preset/invalid` 上加载失败，而且报错只提插件名不提字段，
  // 极难定位（compaction / commands / typert 都踩过）。
  inject: [...new Set([...memoryInject])],
  apply: applyEntry,
};

// 让 `whale-memory` 也能作为本包的一个入口被挂载（patch 里用的是这个名字）。
export { memoryName };
export { apply as whaleMemoryApply } from './memory.js';

/*
 * 好感度（affinity）已于 0.9.16 整体移除。
 *
 * 为什么删：它从设计上就是「建议」而不是「约束」—— 靠一段提示变量 + 一张冲突裁决表
 * 去压一个上万字的人设，实测压不住（活人版设成 -100，提示里「不共戴天的仇人」写得
 * 清清楚楚，她照样第一句「在呢，主人~」）。宿主没有能真正约束模型风格的机制，
 * 继续加码只会让人设越来越自相矛盾。既然做不到，就不留半成品。
 *
 * 一并删掉的：src/affinity.js、src/daemon.js、lib/client.js、设置页「好感度」面板、
 * 四条 whale-affinity 挂载行、宿主级 whale-affinity-daemon 行、人设里的好感度段与
 * {{affinity_vN}} 占位符、affinity 相关校验脚本，以及 ~/.dsh/affinity/ 状态文件。
 * 记忆系统（variable 读 + tool 写）不受影响。
 */
