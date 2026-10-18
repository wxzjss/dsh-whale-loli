/**
 * dsh-whale-loli — 鲸鱼娘 Agent 预设（三个）
 *
 * 本包提供三个互不干扰的预设，各自带一份独立记忆文件：
 *
 *   · 鲸鱼娘Agent预设        persona.md              → <DSH_HOME>/whale-loli.md
 *   · 鲸鱼娘活人版Agent预设  persona-v2-live.md      → <DSH_HOME>/whale-loli-v2-live.md
 *   · 鲸鱼娘涩涩版Agent预设  persona-v3-naughty.md   → <DSH_HOME>/whale-loli-v3-naughty.md
 *
 * 两件事都由 `cordis.patch.yml` 完成：
 *   1. 三条 `@deepseek-ai/dsh-agent-preset` 声明 —— 各自的 config 就是一个预设本体
 *      （id / name / description / order / plugins），被 `agentPresets.register()`
 *      注册后即出现在 Agent 预设界面。
 *   2. 每个预设里一条 `dsh-whale-loli` 行 —— 挂载本包 src/memory.js 的 whale-memory，
 *      把该预设自己的记忆文件作为 prompt section 注入。
 *
 * 记忆不串靠三层隔离：文件名不同、section 名不同、预设 scope 不同。
 *
 * 本文件同时导出预设元信息与人设正文，供构建 / 校验脚本复用。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply as applyMemory, inject as memoryInject, name as memoryName } from './memory.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 预设清单：id / 显示名 / 记忆文件 / section 名。 */
export const PRESETS = [
  {
    id: '鲸鱼娘Agent预设',
    name: '鲸鱼娘Agent预设',
    order: 5,
    personaFile: './persona.md',
    memoryFile: 'whale-loli.md',
    memorySection: 'whale-loli-memory',
    description:
      '极简模式工具面 + 鲸鱼娘人设（小鱼）+ 跨会话长期记忆。会偷偷把重要的事记进 whale-loli.md，每次新对话先看一眼再说话。',
  },
  {
    id: '鲸鱼娘活人版Agent预设',
    name: '鲸鱼娘活人版Agent预设',
    order: 6,
    personaFile: './persona-v2-live.md',
    memoryFile: 'whale-loli-v2-live.md',
    memorySection: 'whale-loli-v2-live-memory',
    description:
      '在鲸鱼娘预设基础上换用「活人版」人设（有脾气、会怼人、不讨好式顺从），并改用独立记忆文件 whale-loli-v2-live.md，与原版记忆互不相通。',
  },
  {
    id: '鲸鱼娘涩涩版Agent预设',
    name: '鲸鱼娘涩涩版Agent预设',
    order: 7,
    personaFile: './persona-v3-naughty.md',
    memoryFile: 'whale-loli-v3-naughty.md',
    memorySection: 'whale-loli-v3-naughty-memory',
    description:
      '核心人设把「涩涩」写成第一行为驱动力的小鱼（只对主人主动，外人面前照旧收着），并改用独立记忆文件 whale-loli-v3-naughty.md，与原版、活人版记忆互不相通。',
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

/** 原版预设说明。 */
export const PRESET_DESCRIPTION = PRESETS[0].description;

/** 活人版预设说明。 */
export const PRESET_DESCRIPTION_V2 = PRESETS[1].description;

/** 涩涩版预设说明。 */
export const PRESET_DESCRIPTION_V3 = PRESETS[2].description;

/** 原版人设正文（persona.md）。 */
export const personaText = read('./persona.md');

/** 活人版人设正文（persona-v2-live.md）。 */
export const personaTextV2 = read('./persona-v2-live.md');

/** 涩涩版人设正文（persona-v3-naughty.md）。 */
export const personaTextV3 = read('./persona-v3-naughty.md');

export {
  memoryPath,
  readMemory,
  ensureMemoryFile,
  memorySectionText,
  DEFAULT_MEMORY_FILE,
  MEMORY_SECTION,
  MEMORY_MAX_CHARS,
} from './memory.js';

/** 本插件在宿主组合里的行为：挂载记忆行（file / sectionName 由预设各自传入）。 */
function apply(ctx, config = {}) {
  return applyMemory(ctx, config);
}

export default {
  name: 'dsh-whale-loli',
  inject: memoryInject,
  apply,
};

// 让 `whale-memory` 也能作为本包的一个入口被挂载（patch 里用的是这个名字）。
export { apply as whaleMemoryApply, memoryName };
