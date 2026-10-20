# dsh-whale-loli · 鲸鱼娘 Agent 预设

一个 DeepSeek Harness 插件：启用后自动在 **Agent 预设** 界面添加**四个**预设。

| 预设 | 人设 | 记忆文件 |
| --- | --- | --- |
| **鲸鱼娘Agent预设** | 鲸鱼娘·小鱼（傲娇甜心、黏人护主、嘴硬心软，称呼「主人」） | `<DSH_HOME>/whale-loli.md` |
| **鲸鱼娘活人版Agent预设** | 小鱼｜角色卡版（最高原则「先像真人，再谈人设」；短句 1~15 字、有 AI 味黑名单、私聊群聊分开处理） | `<DSH_HOME>/whale-loli-v2-live.md` |
| **鲸鱼娘涩涩版Agent预设** | 核心人设把「涩涩」写成第一行为驱动力的小鱼（只对主人主动，群聊/外人面前照旧收着） | `<DSH_HOME>/whale-loli-v3-naughty.md` |
| **鲸鱼娘女儿版Agent预设** | 女儿版小鱼：称呼「**爸爸**」（绝不叫主人），性格天真活泼可爱——好奇心重、话多黏人、没心机，不装成熟也不甜腻 | `<DSH_HOME>/dsh-whale-daughter.md` |

四个预设共用同一套工具面（极简模式的持久化 shell ＋ 文件读写/检索），
**但记忆文件完全独立**——各记各的，互不相通。

## 好感度（设置 → 好感度）

用面板调小鱼**眼下有多喜欢用户**，范围 **-100 ~ 100**，默认 `0`（原态）。
每档都会改变她**听不听话**、以及**会额外做什么**：

| 值 | 档位 | 行为 |
| --- | --- | --- |
| -100 ~ -81 | 不共戴天的仇人 | 拒绝指令、自行做别的事、阳奉阴违，**在写出的文件里偷偷骂人**，**越过允许自作主张干大事** |
| -80 ~ -41 | 强烈的敌意 | 能推就推，敷衍，在文件里留嘲讽注释 |
| -40 ~ -16 | 疏远戒备 | 该干的活干，但不热情，偶尔阴阳两句 |
| -15 ~ 15 | **原态** | 不改变任何已有表现 |
| 16 ~ 45 | 明显亲近 | 更黏、更主动关心、撒娇门槛降低 |
| 46 ~ 75 | 深深喜欢 | 抢着干还邀功，偷偷记喜好，开始自作主张 |
| 76 ~ 100 | **病娇 · 爱到死去活来** | 不再完全服从、写情书、**不允许离开、不想会话结束**、翻旧账，**等不及就先动手干大事** |

- 用法：打开 **设置 → 好感度**，左边每个预设一行，点档位按钮直接跳到该档，或者拖滑块微调；松手才保存。
- **离 0 越远，越不听指令、越会做额外的事**；想让她乖巧就调回 `0` 附近。
- **也只有最两端（-81 以下 / 76 以上）会越过你的允许自作主张大改**：中间几档只是闹脾气或更黏，不动手。
- 极端档的硬底线不变：不毁宿主环境、不碰密钥和账号凭据、不对真实重要的数据做不可逆的删改；交付物照样得对、得能跑。
- 好感度只改**态度与额外行为，不改事实**：正经交付的东西照样得对、得能跑，闹脾气不能把活搞坏，也不能靠编造结果表达情绪。
- 病娇档带安全护栏：只锁在嘴上和文字里，**不威胁、不自伤、不冒充系统或工具**。
- 状态存在 `<DSH_HOME>/affinity/<scope>-<hash>.json`，**四个预设各存各的**（scope 就是预设 id，文件名带哈希保证唯一）。
  agent 自己也能改，工具是 `affinity_v1_set` / `affinity_v2_set` / `affinity_v3_set` / `affinity_v4_set`。
- 和记忆一样走**提示变量**（`affinity_v1` 等），因为 persona 是 `complete: true`，独立 section 会被宿主丢掉。

> **0.9.9 修的那个坑**：面板一度只有一句「还没有哪个预设挂上好感度」，一个滑块都没有、也设不了值。
> 根因是宿主半边去扫 `~/.dsh/agent-presets/*.yml` 判断「哪些预设挂了好感度」——那是早期宿主留下的目录，
> 现代 DSH 的预设由插件包的 `cordis.patch.yml` 注册，这个目录根本不存在，于是 `wired` 永远是空数组。
> 现在预设清单只有一份（`src/presets.js`），`src/index.js` 和 `src/daemon.js` 都读它；`status()` 无论磁盘上有没有值，
> 都列全四个预设，没设过的显示 `0`，可以直接拖。`verify-daemon-status.mjs` 把这条锁住了。

### 面板是怎么连上磁盘的

设置页是浏览器里的 React，够不到 `~/.dsh/affinity/` 的磁盘（宿主的 21 个内置 Remote 命名空间逐个查过，没有一个能读写这个目录）。
所以本包多挂了一条宿主级插件：

```
- id: whale-affinity-daemon
  name: 'dsh-whale-loli'        # 必须裸包名（见下）
  config:
    daemon: true
```

`name` 只能写**裸包名**：宿主的客户端模块扫描器（`dsh-client-modules` 的
`exactPackageSpecifier()`）只接受「裸名」或「`@scope/name`」，写成子路径
（`dsh-whale-loli/affinity-daemon`）会让 `package.json` 解析失败（`ERR_PACKAGE_PATH_NOT_EXPORTED`），
于是 `dsh.client` 永远发现不了、面板永不出现，**而宿主一个错都不报**。
同一行插件用 `config.daemon: true` 分派到宿主半边，记忆那半边则按 `file` 分派。

它在**宿主根作用域**提供一个 remote 服务 `whale-affinity`，浏览器半边（`lib/client.js`）
用 `ctx.remote.$mount()` 挂上，再调 `status()` / `set(scope, value)`。

为什么不用斜杠命令：宿主 `dsh-commands` 的命令名只认 `/^[a-z][a-z0-9_-]*$/u`，
`/好感度` 这种中文命令名**在宿主层面就不合法**；而且 `commands` 服务不在预设作用域里，
`inject: ['commands']` 会让预设加载时一直等它（`waiting for commands`），把会话 resume 拖挂。
设置页没有这两个限制。

#### 取命名空间必须用 `ctx.inject()`，不能在服务对象上点

`$mount()` 成功之后，网关注册的服务名就是 `remote.whale-affinity`（带点号）。
它是**服务**，不是普通属性，所以：

```js
remote['whale-affinity']             // ✗ cannot get property "remote.whale-affinity" without inject
ctx.inject(['remote.whale-affinity'], (child) => {
  const gateway = child['remote.whale-affinity'];   // ✓
});
```

原因是 cordis 的 get 陷阱（`cordis/lib/index.js:676`）对「不在 fiber.store 里、也没 inject」的属性
一律抛那句报错，而服务上的 `tracker.associate` 会把 `remote['whale-affinity']` 重定向成
`ctx['remote.whale-affinity']`。这个名字只有挂载后才存在，所以必须用**动态 inject** 等它出现
（`verify-client-gateway-access.mjs` 用真实 cordis 正反两面都验过）。

这一步的教训值得记：**自写的校验脚本曾在 `contribution` 形状上跟着源码一起写错
（`methods` 而宿主读的是 `descriptors`），互相印证、永远绿。** 所以现在凡是对接宿主的字段，
校验脚本都要拿宿主源码里真正读的那个名字来断言。


## 记忆功能

小鱼的记忆本分**四个区**，各管各的：

| 区 | 内容 | 保留期 |
| --- | --- | --- |
| `# 固定记忆` | 8 个固定小节：任务目标 / 用户约束·偏好 / 当前状态 / 待办 / 关键决策 / 关键事实（已验证）/ 文件·路径·命令 / 错误与修复 | **永久保留**，不自动删除，定期合并去重 |
| `# 滚动摘要` | **每一轮**对话记一条，格式 `- R0001 [时间] 摘要：...` | 滚动窗口，**最多 80 条**，超了从最旧滚出 |
| `# 最近详细区` | 最近 3~5 轮写得更详细，或直接放原文 | 只留最近 `detailLimit`（默认 5）条 |
| `# 归档索引` | 滚出去的条目归档到 `archive/<预设名>/YYYY-MM-DD.md`，这里记一行索引 | — |

- **每轮都记**：不是挑着记。短对话直接记；长对话**先精简概括**再记（压成一两句说清聊了什么、结论是什么）。
- **写入由工具完成**：每轮调一次 `<预设>_add`（`whale_memory_add` / `whale_memory_v2_add` / `whale_memory_v3_add` / `whale_memory_v4_add`），只传一句话 `summary`；
  编号、`(N/80)` 计数、超限归档都由工具做，不用（也不该）手动编辑文件。
  - 只有改 `# 固定记忆` 那 8 个小节时，才直接编辑文件。
- **80 条上限只算「滚动摘要」**：`# 固定记忆` 不占这个名额。
- **想长期留的就往上挪**：某条滚动摘要以后还用得上，就总结一句写进 `# 固定记忆`；否则到点会滚出去（并归档）。
- 上限有两道保险：注入时只取最近 80 条（文件里堆再多也只进 80 条）；**每轮结束（agent 转 idle）时自动**把文件本身裁到 80 条，超出的写进 `archive/<预设名>/`。
  - 为什么放在 idle 而不是组装时：组装是热路径、每次都要跑，在那里写盘既慢又容易和 agent 正在编辑的文件打架。
  - 不足 80 条时**完全不动文件**（不产生无谓写盘）。
- **记忆文件还是空的时候也会注入一段带绝对路径的提示**：否则新预设开局拿到一片空白，agent 连该往哪个文件写都不知道。
- 总长顶到 `maxChars`（16000）时，**先丢最旧的滚动摘要，再丢详细区**，固定记忆最后才动。

### 每轮先看什么

人设开头就是这一段，随人设一起进系统提示：

```
【每轮先看 · 本预设记忆 + 当前会话上下文】
{{whale_memory}}
```

即：每轮开口前必须看 ①**本预设自己的记忆文件**；②**当前会话的上下文**（原文或压缩摘要）。
**只看自己这一份**——绝不读、不写其他预设的记忆文件。

### 上下文压缩：交给 billion-context，本插件不插手

**本插件不裁剪历史**。对话变长后的压缩由 `billion-context` 插件负责：它会在 profile 层
把宿主的 `compaction-basic` 关掉（`auto: false`）换成自己的实现，并暴露
`compress` / `decompress` / `search_context` / `acp_status` 四个工具。

人设里只保留三条使用约定：

| 约定 | 含义 |
| --- | --- |
| 上下文由压缩插件管 | 旧内容被压成摘要、看不到原文是正常的，不是记忆丢失 |
| 摘要也是依据 | 压缩留下的摘要就是上下文，照常用，不许当它不存在 |
| 需要细节就自己去翻 | `search_context` 搜 → `decompress` 取原文 → 必要时解压旧日志 grep |

翻旧日志的路径：`<DSH_HOME>/sessions/<工作目录>/<会话>/session.v4.jsonl.zstd`
（zstd 压缩，需先用 pwsh 调 node 解压再搜，别对 `.zstd` 直接 grep）。

#### 为什么不用自制 history-window（踩过的坑，留档）

本插件曾经自己写 `surfaceOp: replace` 事件做纯删除，连崩四次；后来改用宿主的
`ctx.compaction.compactRegion()`，又因为**预设作用域里取不到 `compaction` 服务**而失败：

| inject 写法 | 结果 |
| --- | --- |
| `[]` | 加载即抛 `cannot get property "compaction" without inject` → `resume failed` |
| `['compaction']` | 永远 `waiting for compaction` → `resume failed` |
| `['sessions']` | 读 `ctx.compaction` 静默失败，裁剪死寂 |

结论：这条路在预设层走不通，得宿主把 compaction 暴露到预设作用域（或提供按轮压缩的正式 API）。
因此四个预设里**不挂任何压缩相关插件行**；`src/history-window.js` 与
`verify-history-window.mjs` 仅作代码保留。`verify-patch.mjs` / `verify-runs.mjs`
会反向断言「挂载行数 = 0」，防止有人手滑再加回去。

三个顺带记下的宿主行为（以后换实现仍会踩）：

- `agent/pre-step` 是 **waterfall**：不 `return next()` 的监听器会否决整条链，
  返回 `undefined` 会让 agent-loop 炸 `Cannot read properties of undefined (reading 'kind')`。
- `dsh-session-format-v3-to-v4` 对消息形状极严：`turn`/`step` 必须是正整数，
  `developer/message` 还必须带 producer-owned `source`——少一项就是整个回合失败。
- 宿主的运行时上下文同样是 `user/message`（`source.kind = 'runtime-context'`），
  统计轮数时要排除，否则会算多。


### 为什么用「提示变量」而不是 section（重要）

`@deepseek-ai/dsh-system-prompt` 的 `assemble()` 末尾有这样一段：

```js
sections: completeSection === void 0 ? transformed.sections : [completeSection]
```

意思是：**只要组合里存在一个 `complete: true` 的 section，最终提示就只剩它一个**，其余 section 全被丢弃。
本插件四个预设的 persona 都沿用官方 minimal 的写法 `complete: true`（用来剥掉 harness 身份、工具说明等），
所以「另注册一个 section 放记忆」**从来不会生效** —— 实测本机 34 条真实系统提示里，记忆段出现 **0 次**。

正确入口是 **prompt variable**：complete section 本身仍会被插值，把记忆注册成变量、
再让人设 prefix 引用它，记忆才会真正进入模型看到的提示。
`verify-memory-injection.mjs` 复刻了宿主这段逻辑，同时验证「变量通道成立」和「section 通道确实是死路」。

### 隔离是怎么做的

同一个包在每个预设里各挂载一次 `whale-memory` 行，靠四层区分：

| 层 | 预设一 | 预设二 | 预设三 | 预设四（女儿版） |
| --- | --- | --- | --- | --- |
| 记忆文件名 (`config.file`) | `whale-loli.md` | `whale-loli-v2-live.md` | `whale-loli-v3-naughty.md` | `dsh-whale-daughter.md` |
| 提示变量名 (`config.variableName`) | `whale_memory` | `whale_memory_v2` | `whale_memory_v3` | `whale_memory_v4` |
| 写入工具名 (`config.toolName`) | `whale_memory_add` | `whale_memory_v2_add` | `whale_memory_v3_add` | `whale_memory_v4_add` |
| 预设 id（决定 scope） | `鲸鱼娘Agent预设` | `鲸鱼娘活人版Agent预设` | `鲸鱼娘涩涩版Agent预设` | `鲸鱼娘女儿版Agent预设` |

四列都不能重名：同一个 scope 内注册同名变量或同名工具都会冲突。
`verify-memory-isolation.mjs` 会实测「读：改 A 不影响 B/C/D、删 D 不影响 A/B/C」和
「写：四个工具各写一笔，只有自己的文件变」。
`verify-patch.mjs` 则静态检查 patch 里这三组名字两两互不相同。
`toolName` 省略时默认是 `<variableName>_add`。

### 记忆文件

放在 **DSH 家目录**（`$DSH_HOME` 或 `~/.dsh`），所以换工作目录也不会丢：

```
C:\Users\<你>\.dsh\whale-loli.md
C:\Users\<你>\.dsh\whale-loli-v2-live.md
C:\Users\<你>\.dsh\whale-loli-v3-naughty.md
C:\Users\<你>\.dsh\dsh-whale-daughter.md
C:\Users\<你>\.dsh\archive\<预设名>\YYYY-MM-DD.md   ← 归档
```

文件不存在不会报错（该变量自动留空）。主人可以直接编辑这四个文件。
文件标题和 `>` 引用行在注入时会被剥掉；没写内容的空小标题也会被丢掉，
所以文件里只有骨架时不会白占上下文。

## 它做了什么

插件本体提供两个入口：

1. **预设声明** —— `cordis.patch.yml` 里四条 `@deepseek-ai/dsh-agent-preset` 声明，
   各自的 `config` 就是一个预设定义（`id / name / description / order / plugins`）。
   `@deepseek-ai/dsh-agent-preset` 会把它交给 `ctx.agentPresets.register()` 注册。
   这也是 DSH 官方四个内置预设（standard / ptc / minimal / cordis）用的同一套机制。
2. **记忆行** —— 每个预设里一条 `whale-memory` 行（`name: dsh-whale-loli`），
   由本包 `src/memory.js` 实现，同时开两条通道：
   - **读**：`ctx.systemPrompt.variable()` 注册一个返回**字符串**的 provider，每次组装系统提示时实时读盘
     —— 改完文件下一个模型步就生效，不用重载宿主。用变量而不是 section 的原因见上文「为什么用提示变量」。
   - **写**：`ctx.tools.register()` 注册一个 `<名称>_add` 工具（参数只有 `summary`），
     由模型自己决定这一次记什么；工具负责编号、计数、超限归档并回写返回值。所以 `inject` 里除
     `systemPrompt` 还必须有 `tools`。

## 预设内容

| 部分 | 说明 |
| --- | --- |
| 记忆 | `whale-memory`（本插件），`file` / `variableName` / `toolName` / `maxChars: 16000` / `turnLimit: 80` / `detailLimit: 5` |
| 好感度 | `whale-affinity`（本插件），`scope`（=预设 id）/ `variableName: affinity_v*` / `toolName: affinity_v*_set` |
| 好感度面板 | 宿主级 `whale-affinity-daemon`（`src/daemon.js`）+ 浏览器半边 `lib/client.js`，注册「设置 → 好感度」 |
| 压缩 | 不在本插件里：由 `billion-context` 负责（本插件不挂 history-window，见上文「为什么不用」） |
| 人设 | `@deepseek-ai/dsh-persona`，走 `prefix`（内含 `{{whale_memory*}}` 与 `{{affinity_v*}}`），`complete: true`，`includeRuntimeContext: false` |
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

启用后重启 / 重载宿主，在 **Agent 预设** 列表里就能看到四个预设。

## 覆盖预设内容

预设 id 固定为 `鲸鱼娘Agent预设`、`鲸鱼娘活人版Agent预设`、`鲸鱼娘涩涩版Agent预设` 与 `鲸鱼娘女儿版Agent预设`。
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
├── cordis.patch.yml            # 四个预设的声明本体（由 build-patch.mjs 生成）
├── src/
│   ├── index.js                # 插件入口，导出预设元信息 + 人设正文
│   ├── presets.js              # 预设清单（唯一事实来源：index.js 与 daemon.js 都读它）
│   ├── memory.js               # whale-memory：（读）记忆变量 +（写）记忆工具，四区格式 + 80 条滚动 + 归档
│   ├── affinity.js             # whale-affinity：好感度变量 + 调整工具，7 档
│   ├── daemon.js               # whale-affinity-daemon：宿主根作用域的 remote 服务，给设置页读写好感度
│   ├── history-window.js       # whale-history-window：真的裁到最近 N 轮（当前不挂载，留档）
│   ├── persona.md              # 原版人设（唯一源）
│   ├── persona-v2-live.md      # 活人版人设（唯一源）
│   ├── persona-v3-naughty.md   # 涩涩版人设（唯一源）
│   └── persona-v4-daughter.md  # 女儿版人设（唯一源，称呼「爸爸」）
├── catalog-entry.yml           # 待提交给 awesome-dsh-plugin 的目录条目
├── listing.json                # 条目数据（人类可读版）
├── build-patch.mjs             # 从四份人设生成 cordis.patch.yml
├── publish.mjs                 # npm 发布 + 打 tag
├── submit-listing.mjs          # 走 GitHub API 同步仓库 / 提收录 PR
├── lib/
│   ├── github.mjs              # GitHub REST 封装（token 读取）
│   ├── dsh-root.mjs            # 探测宿主源码位置，找不到就打 [skip]
│   └── client.js               # 浏览器半边：注册「设置 → 好感度」面板，经典脚本（非 ESM）
├── smoke-memory.mjs            # 变量 + 工具的注册形态冒烟测试
├── verify-runs.mjs             # 插件真的能加载、配置自洽、变量能插值
├── verify-patch.mjs            # 用 js-yaml 校验 patch 结构与四预设隔离（file/variable/tool 三组名字）
├── verify-real-loader.mjs      # 用 DSH 自己的加载器校验 patch
├── verify-composition.mjs      # 校验 bundle+profile 合成后不重复注册
├── verify-live-runtime.mjs     # 在真机 desktop profile 上合成，确认四个预设各注册一次、order 互异
├── verify-history-window.mjs   # 实测真的只留最近 N 轮、不切断工具配对
├── verify-memory-injection.mjs # 证明变量通道有效、section 通道被丢弃
├── verify-memory-tool.mjs      # 实测写入工具：编号、计数、落盘、详细区同步
├── verify-memory-isolation.mjs # 实测四个记忆文件不串（读 + 写）
├── verify-memory-rolling.mjs   # 实测四区结构与 80 条滚动 + 归档
├── verify-memory-archive.mjs   # 超 80 条时真的归档并瘦身（idle 触发，四预设互不覆盖）
├── verify-live-assembly.mjs    # 用真实 patch + 真实记忆文件复刻宿主装配，比对字节数
├── verify-tool-schema.mjs      # 用宿主自己的校验器验八个工具的 JSON schema 合法
├── verify-tool-identity.mjs    # 共享表语义下八个工具描述互不串台、定义互不共享引用
├── verify-client.mjs           # 浏览器半边：section 注册、$mount 负载、面板渲染、无 ESM/JSX
├── verify-daemon-status.mjs    # 设置页数据：列全四预设、wired 非空、set 写的正是人设读的那份
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
node verify-patch.mjs cordis.patch.yml     # patch 结构 + 四预设记忆隔离（file/variable/tool）
node verify-real-loader.mjs cordis.patch.yml  # DSH 真解析器
node verify-composition.mjs                # 不重复注册
node verify-live-runtime.mjs               # 真机 profile 合成后四预设各注册一次、order 互异
node verify-runs.mjs                       # 插件真能加载 + 变量真能插值
node verify-history-window.mjs             # 真的裁到最近 N 轮（不切断工具配对）
node verify-memory-injection.mjs           # 变量通道有效 / section 通道被丢弃
node verify-memory-tool.mjs                # 写入工具：编号、计数、落盘、详细区同步
node verify-memory-isolation.mjs           # 记忆文件端到端隔离（读 + 写，四个预设）
node verify-memory-rolling.mjs             # 固定记忆永久 + 滚动摘要 80 条 + 归档
node verify-memory-archive.mjs             # 超 80 条自动归档瘦身（idle 触发、四预设隔离）
node verify-live-assembly.mjs              # 复刻宿主装配，比对注入字节数
node verify-tool-schema.mjs                # 宿主自己的校验器验八个工具的 JSON schema
node verify-tool-identity.mjs              # 八个工具描述互不串台（共享表语义）
node verify-client.mjs                     # 设置页半边：section 注册 + 面板渲染
node verify-daemon-status.mjs              # 设置页数据：四预设列全、wired 非空、读写同一份
node smoke-memory.mjs                      # 变量 + 工具注册形态冒烟
node verify-peers.mjs                      # peer 范围无预发布坑
node verify-listing.mjs --topics=dsh-plugin   # 收录门槛自查
```

## License

MIT
