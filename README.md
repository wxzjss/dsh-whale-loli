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

小鱼的记忆本分**四个区**，各管各的：

| 区 | 内容 | 保留期 |
| --- | --- | --- |
| `# 固定记忆` | 8 个固定小节：任务目标 / 用户约束·偏好 / 当前状态 / 待办 / 关键决策 / 关键事实（已验证）/ 文件·路径·命令 / 错误与修复 | **永久保留**，不自动删除，定期合并去重 |
| `# 滚动摘要` | **每一轮**对话记一条，格式 `- R0001 [时间] 摘要：...` | 滚动窗口，**最多 80 条**，超了从最旧滚出 |
| `# 最近详细区` | 最近 3~5 轮写得更详细，或直接放原文 | 只留最近 `detailLimit`（默认 5）条 |
| `# 归档索引` | 滚出去的条目归档到 `archive/<预设名>/YYYY-MM-DD.md`，这里记一行索引 | — |

- **每轮都记**：不是挑着记。短对话直接记；长对话**先精简概括**再记（压成一两句说清聊了什么、结论是什么）。
- **80 条上限只算「滚动摘要」**：`# 固定记忆` 不占这个名额。
- **想长期留的就往上挪**：某条滚动摘要以后还用得上，就总结一句写进 `# 固定记忆`；否则到点会滚出去（并归档）。
- 上限有两道保险：注入时只取最近 80 条（文件里堆再多也只进 80 条）；`appendRolling()` / `pruneMemoryFile()` 可把文件本身裁到 80 条并自动归档。
- 总长顶到 `maxChars`（16000）时，**先丢最旧的滚动摘要，再丢详细区**，固定记忆最后才动。

### 每轮先看什么

人设开头就是这一段，随人设一起进系统提示：

```
【每轮先看 · 本预设记忆 + 当前会话最近 20 轮】
{{whale_memory}}
```

即：每轮开口前必须看 ①**本预设自己的记忆文件**；②**当前会话最近 20 轮**上下文。
**只看自己这一份**——绝不读、不写其他预设的记忆文件。

### 20 轮是真的裁，不是嘴上说说

**这一点很重要**：只在人设里写「看最近 20 轮」是**空话**——宿主不会因为那句话就不发旧消息。
实测本机最长会话 33 轮 / 85 条 user 消息 / 1565 条 tool 结果，全部发给模型；
宿主自带的 compaction 只在 token 压力超阈值时才压，粒度是「保留一段 token 尾巴」，**不是轮数**。

所以插件附带 `history-window` 行，用宿主自己的表层替换机制做**纯删除**：

```js
session.append('developer/message', 提示条, {
  surfaceOp: { op: 'replace', startSeq, endSeq },
})
```

被覆盖的表层节点从 `deriveMessages()` 消失——模型真的收不到；会话日志仍保留（可回溯）。
**不调 LLM、不花 token、不生成摘要。**

三条安全线：

| 线 | 做法 |
| --- | --- |
| 工具配对不切断 | 切点必须落在「没有未回应 tool-call」处，复用与 compaction 同款的平衡判定 |
| 系统提示不裁 | 裁剪起点是第一个 `user/message`，**绝不是**表层第 0 个节点 |
| 默认关闭 | 必须 `enable: true` 才裁（本插件预设已开启，`keepTurns: 20`） |

挂载点为 `agent/pre-step`：循环在**派生历史之前**运行它，是唯一既在请求前、又拿得到本 agent 的时机。

#### ⚠️ `agent/pre-step` 是 waterfall，必须 `return next()`

Cordis 的实现是这样的：

```js
waterfall (...args) {
  const cbs = this.dispatch('waterfall', args)
  const inner = args.pop()
  const next = () => (cbs.shift() ?? inner)(...args)
  args.push(next)
  return next()
}
```

**不调用 `next()` 的监听器会否决整条链**，并把自己的返回值当成最终结果。
本插件曾经写成 `async (payload) => { …裁剪… }`（不接 `next`、返回 `undefined`），于是
`agent/pre-step` 的 decision 变成 `undefined`，agent-loop 里 `decision.kind` 直接炸：

```
Cannot read properties of undefined (reading 'kind')
```

表现是**整个回合在第一个 step 之前就失败**，会话日志里只有 `turn/start` → `turn/end(error)`，
连 `step/start` 都没有，极难定位。所以无论裁剪成功、失败还是跳过，都必须 `return next()`。
`verify-history-window.mjs` 第 9 组用例复刻了这个 waterfall 语义，并保留了一个「老写法必崩」的反例。

### 为什么用「提示变量」而不是 section（重要）

`@deepseek-ai/dsh-system-prompt` 的 `assemble()` 末尾有这样一段：

```js
sections: completeSection === void 0 ? transformed.sections : [completeSection]
```

意思是：**只要组合里存在一个 `complete: true` 的 section，最终提示就只剩它一个**，其余 section 全被丢弃。
本插件三个预设的 persona 都沿用官方 minimal 的写法 `complete: true`（用来剥掉 harness 身份、工具说明等），
所以「另注册一个 section 放记忆」**从来不会生效** —— 实测本机 34 条真实系统提示里，记忆段出现 **0 次**。

正确入口是 **prompt variable**：complete section 本身仍会被插值，把记忆注册成变量、
再让人设 prefix 引用它，记忆才会真正进入模型看到的提示。
`verify-memory-injection.mjs` 复刻了宿主这段逻辑，同时验证「变量通道成立」和「section 通道确实是死路」。

### 隔离是怎么做的

同一个包在每个预设里各挂载一次 `whale-memory` 行，靠三层区分：

| 层 | 预设一 | 预设二 | 预设三 |
| --- | --- | --- | --- |
| 记忆文件名 (`config.file`) | `whale-loli.md` | `whale-loli-v2-live.md` | `whale-loli-v3-naughty.md` |
| 提示变量名 (`config.variableName`) | `whale_memory` | `whale_memory_v2` | `whale_memory_v3` |
| 预设 id（决定 scope） | `鲸鱼娘Agent预设` | `鲸鱼娘活人版Agent预设` | `鲸鱼娘涩涩版Agent预设` |

变量名必须不同：否则同一个 scope 内注册同名变量会冲突。
`verify-memory-isolation.mjs` 会实测「改 A 不影响 B/C、删 C 不影响 A/B」。

### 记忆文件

放在 **DSH 家目录**（`$DSH_HOME` 或 `~/.dsh`），所以换工作目录也不会丢：

```
C:\Users\<你>\.dsh\whale-loli.md
C:\Users\<你>\.dsh\whale-loli-v2-live.md
C:\Users\<你>\.dsh\whale-loli-v3-naughty.md
C:\Users\<你>\.dsh\archive\<预设名>\YYYY-MM-DD.md   ← 归档
```

文件不存在不会报错（该变量自动留空）。主人可以直接编辑这三个文件。
文件标题和 `>` 引用行在注入时会被剥掉；没写内容的空小标题也会被丢掉，
所以文件里只有骨架时不会白占上下文。

## 它做了什么

插件本体提供两个入口：

1. **预设声明** —— `cordis.patch.yml` 里三条 `@deepseek-ai/dsh-agent-preset` 声明，
   各自的 `config` 就是一个预设定义（`id / name / description / order / plugins`）。
   `@deepseek-ai/dsh-agent-preset` 会把它交给 `ctx.agentPresets.register()` 注册。
   这也是 DSH 官方四个内置预设（standard / ptc / minimal / cordis）用的同一套机制。
2. **记忆行** —— 每个预设里一条 `whale-memory` 行（`name: dsh-whale-loli`），
   由本包 `src/memory.js` 实现，用 `ctx.systemPrompt.variable()` 注册一个
   返回**字符串**的 provider，每次组装系统提示时实时读盘——改完文件下一个模型步
   就生效，不用重载宿主。用变量而不是 section 的原因见上文「为什么用提示变量」。

## 预设内容

| 部分 | 说明 |
| --- | --- |
| 记忆 | `whale-memory`（本插件），`file` / `variableName` / `maxChars: 16000` / `turnLimit: 80` / `detailLimit: 5` |
| 历史窗口 | `whale-history-window`（本插件），`enable: true` / `keepTurns: 20` —— **真的裁掉 20 轮以前的历史** |
| 人设 | `@deepseek-ai/dsh-persona`，走 `prefix`（内含 `{{whale_memory*}}`），`complete: true`，`includeRuntimeContext: false` |
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
│   ├── memory.js               # whale-memory 记忆变量（四区格式 + 80 条滚动 + 归档）
│   ├── history-window.js       # whale-history-window：真的裁到最近 N 轮
│   ├── persona.md              # 原版人设（唯一源）
│   ├── persona-v2-live.md      # 活人版人设（唯一源）
│   └── persona-v3-naughty.md   # 涩涩版人设（唯一源）
├── catalog-entry.yml           # 待提交给 awesome-dsh-plugin 的目录条目
├── listing.json                # 条目数据（人类可读版）
├── build-patch.mjs             # 从两份人设生成 cordis.patch.yml
├── publish.mjs                 # npm 发布 + 打 tag
├── submit-listing.mjs          # 走 GitHub API 同步仓库 / 提收录 PR
├── lib/github.mjs              # GitHub REST 封装（token 读取）
├── smoke-memory.mjs            # 记忆变量冒烟测试
├── verify-runs.mjs             # 插件真的能加载、配置自洽、变量能插值
├── verify-patch.mjs            # 用 js-yaml 校验 patch 结构与三预设隔离
├── verify-real-loader.mjs      # 用 DSH 自己的加载器校验 patch
├── verify-composition.mjs      # 校验 bundle+profile 合成后不重复注册
├── verify-history-window.mjs   # 实测真的只留最近 N 轮、不切断工具配对
├── verify-memory-injection.mjs # 证明变量通道有效、section 通道被丢弃
├── verify-memory-isolation.mjs # 实测三个记忆文件不串
├── verify-memory-rolling.mjs   # 实测四区结构与 80 条滚动 + 归档
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
node verify-runs.mjs                       # 插件真能加载 + 变量真能插值
node verify-history-window.mjs             # 真的裁到最近 N 轮（不切断工具配对）
node verify-memory-injection.mjs           # 变量通道有效 / section 通道被丢弃
node verify-memory-isolation.mjs           # 记忆文件端到端隔离（三个预设）
node verify-memory-rolling.mjs             # 固定记忆永久 + 滚动摘要 80 条 + 归档
node smoke-memory.mjs                      # 记忆变量冒烟
node verify-peers.mjs                      # peer 范围无预发布坑
node verify-listing.mjs --topics=dsh-plugin   # 收录门槛自查
```

## License

MIT
