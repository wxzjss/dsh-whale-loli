# dsh-whale-loli · 鲸鱼娘 Agent 预设

一个 DeepSeek Harness 插件：启用后自动在 **Agent 预设** 界面添加**三个**预设。

| 预设 | 人设 | 记忆文件 |
| --- | --- | --- |
| **鲸鱼娘Agent预设** | 鲸鱼娘·小鱼（傲娇甜心、黏人护主、嘴硬心软） | `<DSH_HOME>/whale-loli.md` |
| **鲸鱼娘活人版Agent预设** | 小鱼｜角色卡版（最高原则「先像真人，再谈人设」；短句 1~15 字、有 AI 味黑名单、私聊群聊分开处理） | `<DSH_HOME>/whale-loli-v2-live.md` |
| **鲸鱼娘涩涩版Agent预设** | 核心人设把「涩涩」写成第一行为驱动力的小鱼（只对主人主动，群聊/外人面前照旧收着） | `<DSH_HOME>/whale-loli-v3-naughty.md` |

三个预设共用同一套工具面（极简模式的持久化 shell ＋ 文件读写/检索），
**但记忆文件完全独立**——各记各的，互不相通。

## 记忆功能

小鱼的记忆本分**两个区**，写法和保留期完全不同：

| 区 | 内容 | 保留期 |
| --- | --- | --- |
| `## 重要记忆` | 长期事实与约定（主人的偏好、忌讳、重要约定、正在做的事、答应过的事……） | **永久保留**，不被轮数挤掉 |
| `## 对话记录` | **每一轮**对话都记一条 | 滚动窗口，**只留最近 80 轮**，超了从最旧滚出 |

- **每轮都记**：不是挑着记。短对话直接记一条；长对话**先精简概括**再记（压成一两句说清聊了什么、结论是什么）。
- **80 轮上限只算「对话记录」**：`## 重要记忆` 不占这个名额。系统提示里 `## 对话记录（N/80 轮）` 就是当前用量。
- **想长期留的就往上挪**：某条对话以后还用得上，就总结一句写进 `## 重要记忆`；否则到点会被滚出去。
- 上限有两道保险：注入时只取最近 80 轮（文件里堆再多也只进 80 轮）；`pruneMemoryFile()` 可以把文件本身裁到 80 轮。
- 总长顶到 `maxChars`（16000）时，**先丢最旧的对话轮次**，重要记忆最后才动。

每次新对话开始，记忆文件会**自动作为提示段注入**——不是等模型想起来去读，
而是在系统提示组装时就带上，所以小鱼开口前就已经「看过」了。

### 隔离是怎么做的

同一个包在每个预设里各挂载一次 `whale-memory` 行，靠三层区分：

| 层 | 预设一 | 预设二 | 预设三 |
| --- | --- | --- | --- |
| 记忆文件名 (`config.file`) | `whale-loli.md` | `whale-loli-v2-live.md` | `whale-loli-v3-naughty.md` |
| 提示段名 (`config.sectionName`) | `whale-loli-memory` | `whale-loli-v2-live-memory` | `whale-loli-v3-naughty-memory` |
| 预设 id（决定 scope） | `鲸鱼娘Agent预设` | `鲸鱼娘活人版Agent预设` | `鲸鱼娘涩涩版Agent预设` |

`sectionName` 必须不同：否则同一个 scope 内注册两个同名 section 会冲突。
`verify-memory-isolation.mjs` 会实测「改 A 不影响 B/C、删 C 不影响 A/B」。

### 记忆文件

放在 **DSH 家目录**（`$DSH_HOME` 或 `~/.dsh`），所以换工作目录也不会丢：

```
C:\Users\<你>\.dsh\whale-loli.md
C:\Users\<你>\.dsh\whale-loli-v2-live.md
C:\Users\<你>\.dsh\whale-loli-v3-naughty.md
```

文件不存在不会报错（该提示段自动留空）。主人可以直接编辑这三个文件。
一级标题和 `>` 引用行在注入时会被剥掉；没写内容的 `###` 空小标题也会被丢掉，
所以文件里只有骨架时不会白占上下文。

## 它做了什么

插件本体提供两个入口：

1. **预设声明** —— `cordis.patch.yml` 里三条 `@deepseek-ai/dsh-agent-preset` 声明，
   各自的 `config` 就是一个预设定义（`id / name / description / order / plugins`）。
   `@deepseek-ai/dsh-agent-preset` 会把它交给 `ctx.agentPresets.register()` 注册。
   这也是 DSH 官方四个内置预设（standard / ptc / minimal / cordis）用的同一套机制。
2. **记忆行** —— 每个预设里一条 `whale-memory` 行（`name: dsh-whale-loli`），
   由本包 `src/memory.js` 实现，用 `ctx.systemPrompt.section()` 注册一个
   `text` 是**函数**的提示段，每次组装系统提示时实时读盘——改完文件下一个模型步
   就生效，不用重载宿主。

## 预设内容

| 部分 | 说明 |
| --- | --- |
| 记忆 | `whale-memory`（本插件），`file` / `sectionName` / `maxChars: 16000` / `turnLimit: 80` |
| 人设 | `@deepseek-ai/dsh-persona`，走 `prefix`，`complete: true`，`includeRuntimeContext: false` |
| 指令 | `@deepseek-ai/dsh-agent-instructions`，`maxBytes: 65536` |
| 文件 | `@deepseek-ai/dsh-tool-fs`（read/write/edit）、`@deepseek-ai/dsh-tool-fs-search`（glob/grep） |
| Shell | `cordis:group` + `isolate.terminals: true`，Windows 下 pwsh、非 Windows 下 bash，`timeoutMs: 300000` |

## 安装

从 DSH 插件市场安装，或：

```bash
dsh plugin install dsh-whale-loli
# 或直接装 npm 包
npm install dsh-whale-loli
```

启用后重启 / 重载宿主，在 **Agent 预设** 列表里就能看到三个预设。

## 覆盖预设内容

预设 id 固定为 `鲸鱼娘Agent预设`、`鲸鱼娘活人版Agent预设` 与 `鲸鱼娘涩涩版Agent预设`。
可以在 profile 的 patch 里按 id 覆盖，不用改插件本身：

```yaml
- id: preset-鲸鱼娘活人版Agent预设
  config:
    plugins:
      # 你的覆盖内容
```

## 目录结构

```
dsh-whale-loli/
├── package.json                # dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml            # 三个预设的声明本体（由 build-patch.mjs 生成）
├── src/
│   ├── index.js                # 插件入口，导出预设元信息 + 人设正文
│   ├── memory.js               # whale-memory 记忆行实现（参数化记忆文件）
│   ├── persona.md              # 原版人设（唯一源）
│   ├── persona-v2-live.md      # 活人版人设（唯一源）
│   └── persona-v3-naughty.md   # 涩涩版人设（唯一源）
├── catalog-entry.yml           # 待提交给 awesome-dsh-plugin 的目录条目
├── listing.json                # 条目数据（人类可读版）
├── build-patch.mjs             # 从两份人设生成 cordis.patch.yml
├── publish.mjs                 # npm 发布 + 打 tag
├── submit-listing.mjs          # 走 GitHub API 同步仓库 / 提收录 PR
├── lib/github.mjs              # GitHub REST 封装（token 读取）
├── smoke-memory.mjs            # 记忆行冒烟测试
├── verify-patch.mjs            # 用 js-yaml 校验 patch 结构与三预设隔离
├── verify-real-loader.mjs      # 用 DSH 自己的加载器校验 patch
├── verify-composition.mjs      # 校验 bundle+profile 合成后不重复注册
├── verify-memory-isolation.mjs # 实测三个记忆文件不串
├── verify-memory-rolling.mjs   # 实测两区结构与 80 轮滚动上限
├── verify-peers.mjs            # 校验 peer 范围覆盖 harness 各发布档
├── verify-listing.mjs          # 复刻插件目录的收录门槛自查
└── prove-collision.mjs         # 复现并证明重复注册冲突
```

改动人设后重新生成 patch：

```bash
node build-patch.mjs && node verify-patch.mjs cordis.patch.yml
```

## 开发校验

```bash
node verify-patch.mjs cordis.patch.yml     # patch 结构 + 三预设记忆隔离
node verify-real-loader.mjs cordis.patch.yml  # DSH 真解析器
node verify-composition.mjs                # 不重复注册
node verify-memory-isolation.mjs           # 记忆文件端到端隔离（三个预设）
node verify-memory-rolling.mjs             # 重要记忆永久 + 对话记录 80 轮滚动
node smoke-memory.mjs                      # 记忆行冒烟
node verify-peers.mjs                      # peer 范围无预发布坑
node verify-listing.mjs --topics=dsh-plugin   # 收录门槛自查
```

## License

MIT
