// 生成 dsh-whale-loli/cordis.patch.yml。
//
// 本 bundle 提供三个互不干扰的 Agent 预设，各自带一份独立记忆文件：
//   · 鲸鱼娘Agent预设        —— persona.md              → whale-loli.md
//   · 鲸鱼娘活人版Agent预设  —— persona-v2-live.md      → whale-loli-v2-live.md
//   · 鲸鱼娘涩涩版Agent预设  —— persona-v3-naughty.md   → whale-loli-v3-naughty.md
//
// 「不串」靠三层隔离：
//   1) 记忆文件名不同（whale-memory 的 config.file）
//   2) prompt section 名不同（config.sectionName，否则同 scope 注册冲突）
//   3) 预设 id 不同 → registry 各自挂载、各自 scope
// 只为构建方便，不随包发布。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/** 把正文安全地嵌成块标量（位于 `prefix: |-` 之下，缩进 16 空格）。 */
function block(text, spaces = 16) {
  const indent = ' '.repeat(spaces);
  return text
    .replace(/\r\n/g, '\n')
    .trimEnd()
    .split('\n')
    .map((l) => (l.length ? indent + l : ''))
    .join('\n');
}

const persona = readFileSync(root + 'src/persona.md', 'utf8');
const personaV2 = readFileSync(root + 'src/persona-v2-live.md', 'utf8');
const personaV3 = readFileSync(root + 'src/persona-v3-naughty.md', 'utf8');

/** 三个预设共用的工具面行（含参数化记忆行）。 */
function toolRows({ memoryFile, memoryVariable, memoryMax, memoryTurns, memoryDetail }) {
  return `          # 长期记忆：注册成提示变量，由人设开头的 {{${memoryVariable}}} 引用。
          # persona 是 complete:true，宿主会把独立 section 丢掉（见 src/memory.js 顶部注释），
          # 所以记忆必须走 variable 通道；variableName 也要每预设不同，否则同 scope 注册冲突。
          - id: whale-memory
            name: 'dsh-whale-loli'
            config:
              file: ${memoryFile}
              variableName: ${memoryVariable}
              maxChars: ${memoryMax}
              turnLimit: ${memoryTurns}
              detailLimit: ${memoryDetail}
          # ⚠️ whale-history-window **不挂**（已确认这条路走不通，见下）。
          #
          # 想做的效果：让「最近 N 轮」以外的内容不计入输入。唯一不自己写事件的办法是调
          # 宿主的 ctx.compaction.compactRegion()，但预设作用域里拿不到 compaction 服务：
          #   · inject:['sessions']  → 读 ctx.compaction 非法，异常被吞，表现「裁剪死寂」
          #   · inject:[]            → 加载即抛，resume failed（cannot get property without inject）
          #   · inject:['compaction']→ 永远「waiting for compaction」，resume failed
          # 根本原因：inject 是静态声明，服务在预设作用域里不可达时插件会无限等待，
          # 连带把会话 resume 拖挂。这不是配置能绕的，得宿主层面把 compaction 暴露到
          # 预设作用域（或提供「按轮压缩」的正式 API）才行。
          #
          # 替代方案（都不需要插件）：
          #   · 宿主自带 /compact 命令，手动压一次；
          #   · 或者直接开新会话。
          # 压缩交给 billion-context 插件自己做（它会把旧内容压成摘要）；
          # 人设里保留提示层：认摘要为依据 + 需要原文时自己翻
          # （search_context / decompress / 解压旧日志）。
          # 代码与单测留在 src/history-window.js，等宿主放开再说。
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
          # 文件读写：维护 ${memoryFile}、干主人交代的活
          - id: tool-fs
            name: '@deepseek-ai/dsh-tool-fs'
          # 文件检索：找文件、找内容
          - id: tool-fs-search
            name: '@deepseek-ai/dsh-tool-fs-search'
            config:
              sampleOverCapGlobResults: false
          # 持久化 shell（与官方 minimal 一致）
          - id: persistent-shell
            name: cordis:group
            group: true
            isolate:
              terminals: true
            config:
              - id: pty
                name: '@deepseek-ai/dsh-terminal'
              - id: terminal-bash
                name: '@deepseek-ai/dsh-terminal-bash'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 300000
              - id: persistent-bash
                name: '@deepseek-ai/dsh-tool-bash-persistent'
                disabled: !!js process.platform === 'win32'
                config:
                  timeoutMs: 300000
              - id: terminal-pwsh
                name: '@deepseek-ai/dsh-terminal-bash'
                disabled: !!js process.platform !== 'win32'
                config:
                  shellDialect: pwsh
                  timeoutMs: 300000
              - id: persistent-pwsh
                name: '@deepseek-ai/dsh-tool-pwsh-persistent'
                disabled: !!js process.platform !== 'win32'
                config:
                  timeoutMs: 300000
`;
}

const yml = `# dsh-whale-loli bundle patch — 鲸鱼娘 Agent 预设（三个）
#
# 本 bundle 往宿主组合里插三条东西：
#
#   1) 三条 \`@deepseek-ai/dsh-agent-preset\` 声明 —— 每条的 config 就是一个预设本体
#      （id / name / description / order / plugins），被 \`agentPresets.register()\`
#      注册后即出现在 Agent 预设界面。
#   2) 三条 \`dsh-whale-loli\` 行 —— 各挂载本包 src/memory.js 里的 whale-memory，
#      分别把 <DSH_HOME>/whale-loli.md、whale-loli-v2-live.md、whale-loli-v3-naughty.md
#      作为 prompt section 注入，实现三套互不相通的跨会话记忆。
#
# 记忆隔离要点：三条记忆行的 config.file / config.sectionName 都不一样，
# 且分属不同预设 scope，所以三个记忆文件不会被读串或写串。
- insert:
    # ── 预设一：鲸鱼娘Agent预设（原版）────────────────────────────────────
    - id: preset-鲸鱼娘Agent预设
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: 鲸鱼娘Agent预设
        name: 鲸鱼娘Agent预设
        description: 极简模式工具面 + 鲸鱼娘人设（小鱼）+ 跨会话长期记忆。会偷偷把重要的事记进 whale-loli.md，每次新对话先看一眼再说话。
        order: 5
        plugins:
          # 人设：走 dsh-persona 的 prefix，不注入运行时上下文
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
${block(persona)}
              complete: true
              includeRuntimeContext: false
${toolRows({ memoryFile: 'whale-loli.md', memoryVariable: 'whale_memory', memoryMax: 16000, memoryTurns: 80, memoryDetail: 5 })}
    # ── 预设二：鲸鱼娘活人版Agent预设 ────────────────────────────────────
    - id: preset-鲸鱼娘活人版Agent预设
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: 鲸鱼娘活人版Agent预设
        name: 鲸鱼娘活人版Agent预设
        description: 在鲸鱼娘预设基础上换用「活人版」人设（有脾气、会怼人、不讨好式顺从），并改用独立记忆文件 whale-loli-v2-live.md，与原版记忆互不相通。
        order: 6
        plugins:
          # 人设：活人版（融合版）
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
${block(personaV2)}
              complete: true
              includeRuntimeContext: false
${toolRows({ memoryFile: 'whale-loli-v2-live.md', memoryVariable: 'whale_memory_v2', memoryMax: 16000, memoryTurns: 80, memoryDetail: 5 })}
    # ── 预设三：鲸鱼娘涩涩版Agent预设 ────────────────────────────────────
    - id: preset-鲸鱼娘涩涩版Agent预设
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: 鲸鱼娘涩涩版Agent预设
        name: 鲸鱼娘涩涩版Agent预设
        description: 核心人设把「涩涩」写成第一行为驱动力的小鱼（只对主人主动，外人面前照旧收着），并改用独立记忆文件 whale-loli-v3-naughty.md，与原版、活人版记忆互不相通。
        order: 7
        plugins:
          # 人设：涩涩版
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
${block(personaV3)}
              complete: true
              includeRuntimeContext: false
${toolRows({ memoryFile: 'whale-loli-v3-naughty.md', memoryVariable: 'whale_memory_v3', memoryMax: 16000, memoryTurns: 80, memoryDetail: 5 })}
`;

writeFileSync(root + 'cordis.patch.yml', yml, 'utf8');
console.log(
  'wrote cordis.patch.yml, chars=%d, personaA lines=%d, personaB lines=%d, personaC lines=%d',
  yml.length,
  persona.split('\n').length,
  personaV2.split('\n').length,
  personaV3.split('\n').length,
);
