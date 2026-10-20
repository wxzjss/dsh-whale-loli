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

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 预设清单：id / 显示名 / 记忆文件 / 提示变量名。 */
export const PRESETS = [
  {
    id: '鲸鱼娘Agent预设',
    name: '鲸鱼娘Agent预设',
    order: 5,
    personaFile: './persona.md',
    memoryFile: 'whale-loli.md',
    memoryVariable: 'whale_memory',
    description:
      '极简模式工具面 + 鲸鱼娘人设（小鱼）+ 跨会话长期记忆。会偷偷把重要的事记进 whale-loli.md，每次新对话先看一眼再说话。',
  },
  {
    id: '鲸鱼娘活人版Agent预设',
    name: '鲸鱼娘活人版Agent预设',
    order: 6,
    personaFile: './persona-v2-live.md',
    memoryFile: 'whale-loli-v2-live.md',
    memoryVariable: 'whale_memory_v2',
    description:
      '在鲸鱼娘预设基础上换用「活人版」人设（有脾气、会怼人、不讨好式顺从），并改用独立记忆文件 whale-loli-v2-live.md，与原版记忆互不相通。',
  },
  {
    id: '鲸鱼娘涩涩版Agent预设',
    name: '鲸鱼娘涩涩版Agent预设',
    order: 7,
    personaFile: './persona-v3-naughty.md',
    memoryFile: 'whale-loli-v3-naughty.md',
    memoryVariable: 'whale_memory_v3',
    description:
      '核心人设把「涩涩」写成第一行为驱动力的小鱼（只对主人主动，外人面前照旧收着），并改用独立记忆文件 whale-loli-v3-naughty.md，与原版、活人版记忆互不相通。',
  },
  {
    id: '鲸鱼娘女儿版Agent预设',
    name: '鲸鱼娘女儿版Agent预设',
    order: 8,
    personaFile: './persona-v4-daughter.md',
    memoryFile: 'dsh-whale-daughter.md',
    memoryVariable: 'whale_memory_v4',
    description:
      '女儿版小鱼：称呼「爸爸」，性格天真活泼可爱（好奇心重、黏人、没心机），并改用独立记忆文件 dsh-whale-daughter.md，与原版、活人版、涩涩版记忆互不相通。',
  },
];

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

/** 好感度行（scope / variableName / toolName / commandName 由预设各自传入）。 */
function applyAffinityRow(ctx, config = {}) {
  return applyAffinity(ctx, config);
}

export default {
  name: 'dsh-whale-loli',
  // 注意：`inject` 是静态声明，只能写预设作用域里**一直存在**的服务名。
  // 千万别把不存在的服务名写进来 —— 宿主会一直等它，结果是**所有**预设
  // 都挂在 `agent-preset/invalid` 上加载失败，而且报错只提插件名不提字段，
  // 极难定位。现在的值是 `./memory.js` 里的 `inject`（只有必然存在的那个）。
  inject: memoryInject,
  apply,
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
