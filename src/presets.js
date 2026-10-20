/**
 * 预设清单：唯一事实来源。
 *
 * `src/index.js`（挂载预设与记忆/好感度行）和 `src/daemon.js`（设置页好感度面板的
 * 宿主半边）都从这里读，避免两边各写一份清单然后对不上 —— 2026-10-21 面板
 * 「只有一段文字、没有档位按钮」就是因为 daemon 去扫 `~/.dsh/agent-presets/`
 * 找一个现代宿主根本不用的目录，结果一个预设都没列出来。
 *
 * 四个预设在 patch 里各自挂一条 `whale-affinity`，`scope` 就是 `id` 本身
 * （见 `build-patch.mjs`），所以设置页面板必须用同一个 `id` 去读写，
 * 否则面板写的文件和人设读的不是同一份。
 */

/** 预设清单：id / 显示名 / 记忆文件 / 提示变量名 / 好感度变量与工具名。 */
export const PRESETS = [
  {
    id: '鲸鱼娘Agent预设',
    name: '鲸鱼娘Agent预设',
    order: 5,
    personaFile: './persona.md',
    memoryFile: 'whale-loli.md',
    memoryVariable: 'whale_memory',
    affinityVariable: 'affinity_v1',
    affinityTool: 'affinity_v1_set',
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
    affinityVariable: 'affinity_v2',
    affinityTool: 'affinity_v2_set',
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
    affinityVariable: 'affinity_v3',
    affinityTool: 'affinity_v3_set',
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
    affinityVariable: 'affinity_v4',
    affinityTool: 'affinity_v4_set',
    description:
      '女儿版小鱼：称呼「爸爸」，性格天真活泼可爱（好奇心重、黏人、没心机），并改用独立记忆文件 dsh-whale-daughter.md，与原版、活人版、涩涩版记忆互不相通。',
  },
];

/** 预设 id 列表。 */
export const PRESET_IDS = PRESETS.map((preset) => preset.id);

/** 按 id 取预设。 */
export function presetById(presetId) {
  return PRESETS.find((preset) => preset.id === presetId);
}

/** 预设 id → 好感度变量名。 */
export const AFFINITY_VARIABLES = Object.freeze(
  Object.fromEntries(PRESETS.map((preset) => [preset.id, preset.affinityVariable])),
);

/** 预设 id → 好感度写入工具名。 */
export const AFFINITY_TOOLS = Object.freeze(
  Object.fromEntries(PRESETS.map((preset) => [preset.id, preset.affinityTool])),
);

export default PRESETS;
