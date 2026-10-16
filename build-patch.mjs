// 生成 dsh-whale-loli/cordis.patch.yml，把人设正文安全地嵌成 YAML 块标量。
// 只为构建方便，不随包发布。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const persona = readFileSync(root + 'src/persona.md', 'utf8').replace(/\r\n/g, '\n').trimEnd();

// 块标量内容整体缩进 16 空格（位于 prefix: |- 之下）
const indent = ' '.repeat(16);
const personaBlock = persona
  .split('\n')
  .map((l) => (l.length ? indent + l : ''))
  .join('\n');

const yml = `# dsh-whale-loli bundle patch — 鲸鱼娘Agent预设
#
# 本插件不携带宿主运行时行为：唯一作用是往组合里 insert 一条
# \`@deepseek-ai/dsh-agent-preset\` 声明。那条声明的 config 就是预设定义本体，
# 被 \`agentPresets.register()\` 注册后即出现在 Agent 预设界面。
#
# 预设 id 固定为 \`鲸鱼娘Agent预设\`；profile 的 patch 仍可按此 id 覆盖 config.plugins。
- insert:
    - id: preset-鲸鱼娘Agent预设
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: 鲸鱼娘Agent预设
        name: 鲸鱼娘Agent预设
        description: 极简模式基底 + 鲸鱼娘人设（小鱼）。只有 shell 可用，日常陪伴、傲娇甜心。
        order: 5
        plugins:
          # 人设：走 dsh-persona 的 prefix，不注入运行时上下文
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: |-
${personaBlock}
              complete: true
              includeRuntimeContext: false
          # 与官方 minimal 预设一致的工具面：仅持久化 shell
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
            config:
              maxBytes: 65536
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

writeFileSync(root + 'cordis.patch.yml', yml, 'utf8');
console.log('wrote cordis.patch.yml, chars=%d, persona lines=%d', yml.length, persona.split('\n').length);
