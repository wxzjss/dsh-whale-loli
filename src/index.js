/**
 * dsh-whale-loli — 鲸鱼娘Agent预设
 *
 * 这个插件本身不挂载任何运行时行为；它的全部作用是通过 `cordis.patch.yml`
 * 往宿主组合里插入一条 `@deepseek-ai/dsh-agent-preset` 声明，那条声明的
 * config 就是「鲸鱼娘Agent预设」的完整定义（id / name / description / order /
 * plugins）。预设被注册进 `agentPresets` 服务后，Agent 预设界面会自动列出它。
 *
 * 之所以仍需要这个 `src/index.js`：DSH 的 bundle 加载器要求插件的 `exports`
 * 根入口可被 import（见 package.json 的 `dsh.bundle.patch`），它同时负责在
 * 运行时把 `src/persona.md` 读成字符串，供构建/校验与自检使用。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 预设 id（Agent 预设界面里的稳定标识，也是 profile patch 覆盖用的 id）。 */
export const PRESET_ID = '鲸鱼娘Agent预设';

/** 预设显示名。 */
export const PRESET_NAME = '鲸鱼娘Agent预设';

/** 预设说明。 */
export const PRESET_DESCRIPTION =
  '极简模式基底 + 鲸鱼娘人设（小鱼）。只有 shell 可用，日常陪伴、傲娇甜心。';

/** 人设正文，来自同目录的 persona.md。 */
export const personaText = readFileSync(
  fileURLToPath(new URL('./persona.md', import.meta.url)),
  'utf8',
);

export default {
  name: 'dsh-whale-loli',
  apply() {
    // 预设注册完全由 cordis.patch.yml 里的 dsh-agent-preset 声明完成。
    // 这里不需要做任何事。
  },
};
