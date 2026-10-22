/**
 * 预设清单：唯一事实来源。
 *
 * `src/index.js` 从这里读，`build-patch.mjs` 也从同一份数据生成 patch，
 * 避免两边各写一份清单然后对不上。
 *
 * 每个预设在 patch 里挂一条 `dsh-whale-loli` 行（记忆：读变量 + 写工具），
 * `scope` 就是 `id` 本身。
 *
 * 好感度（affinity）已于 0.9.16 整体移除，见 src/index.js 末尾说明。
 */

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

/** 预设 id 列表。 */
export const PRESET_IDS = PRESETS.map((preset) => preset.id);

/** 按 id 取预设。 */
export function presetById(presetId) {
  return PRESETS.find((preset) => preset.id === presetId);
}

export default PRESETS;
