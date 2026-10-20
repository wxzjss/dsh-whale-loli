# 记忆文件格式与规则

四个预设各有一份独立记忆文件，格式**完全相同**，规则也相同：

| 预设 | 记忆文件 | 提示变量名 | 写入工具名 | 归档目录 |
| --- | --- | --- | --- | --- |
| 鲸鱼娘Agent预设 | `<DSH_HOME>/whale-loli.md` | `whale_memory` | `whale_memory_add` | `archive/whale-loli/` |
| 鲸鱼娘活人版Agent预设 | `<DSH_HOME>/whale-loli-v2-live.md` | `whale_memory_v2` | `whale_memory_v2_add` | `archive/whale-loli-v2-live/` |
| 鲸鱼娘涩涩版Agent预设 | `<DSH_HOME>/whale-loli-v3-naughty.md` | `whale_memory_v3` | `whale_memory_v3_add` | `archive/whale-loli-v3-naughty/` |
| 鲸鱼娘女儿版Agent预设 | `<DSH_HOME>/dsh-whale-daughter.md` | `whale_memory_v4` | `whale_memory_v4_add` | `archive/dsh-whale-daughter/` |

**读写是对称的两条通道**：`variable` 负责每轮把内容塞进系统提示（读），`tools` 负责让她自己往滚动摘要里添（写）。
两条都必须存在 —— 只读的话，人设写着「每轮都要记」，她手里却没有笔。

## 文件结构

```markdown
# 鲸鱼娘记忆 · <文件名>

> 说明行（注入时会被剥掉，只给人看）

# 固定记忆（不自动删除，定期合并去重）

## 任务目标

## 用户约束/偏好

## 当前状态

## 待办

## 关键决策

- 2026-10-19 决定把记忆改走变量通道，而不是 section。

## 关键事实（已验证）

- 主人不自己写代码，让小鱼代劳。

## 文件/路径/命令

## 错误与修复

- complete:true 会丢掉独立 section，记忆必须走 variable。

# 滚动摘要（最多80条，FIFO）

- R0001 [2026-10-19 12:30] 摘要：主人让把记忆格式改成固定区+滚动区
- R0002 [2026-10-19 12:40] 摘要：确认了变量通道才真的进系统提示

# 最近详细区（最近 5 轮保留更详细摘要或原文）

- R0002 [2026-10-19 12:40] 摘要：……（写详细一点，或贴原文）

# 归档索引

- archive/whale-loli/2026-10-19.md（3 条）
```

**区标题单独占一行，内容从标题的下一行开始写。**

## 四个区的规则

| | `# 固定记忆` | `# 滚动摘要` | `# 最近详细区` | `# 归档索引` |
| --- | --- | --- | --- | --- |
| 放什么 | 8 个固定小节的稳定事实 | 每轮一条 `- R0001 [时间] 摘要：...` | 最近几轮写详细些/贴原文 | 归档文件索引 |
| 保留期 | **永久**，不自动删除 | **最多 80 条**，FIFO 滚出 | 最近 `detailLimit`（默认 5）条 | 一直累积 |
| 占不占 80 条名额 | 不占 | 占 | 不占 | 不占 |

固定区 8 个小节，顺序固定：

```
## 任务目标
## 用户约束/偏好
## 当前状态
## 待办
## 关键决策
## 关键事实（已验证）
## 文件/路径/命令
## 错误与修复
```

## 填写规则（人设里也写了同一套）

1. **每一轮都要往「滚动摘要」加一条**，不是挑着记。
2. **用工具写，不要手动编辑文件**：调 `whale_memory_add`（活人版 `whale_memory_v2_add`、涩涩版 `whale_memory_v3_add`、女儿版 `whale_memory_v4_add`），
   只传 `summary` 一句话。编号、`(N/80)` 计数、超限归档全部由工具负责。
3. 短对话直接照实记；**长对话先精简概括再记**，压成一两句说清「聊了什么、结论是什么」。
4. 一条 6~60 字，写「发生了什么 + 情绪/结论」，别复述全文。
5. 写到第 81 条时，最旧那条自动滚出去 —— 归档到 `archive/<预设名>/YYYY-MM-DD.md`，`# 归档索引` 里留一行。
6. **固定记忆不算在 80 条里**：值得长期留的另写进 `# 固定记忆` 对应小节（这一步才需要动手编辑文件），并定期合并去重。
7. 滚动条目以后还用得上，就总结一句挪进 `# 固定记忆`；否则到点会滚出去。

## 写入工具

`ctx.tools.register()` 注册，参数只有一个 `summary`：

```json
{ "summary": "主人说今天加班到十点，我提醒他吃夜宵" }
```

返回 `{ id, path, count, limit, archived }`，例如
`{ id: "R0042", path: "<DSH_HOME>/whale-loli-v3-naughty.md", count: 42, limit: 80, archived: 0 }`。

- `id` 由 `nextTurnId()` 从文件里现有最大编号 +1 算出，不用模型自己数。
- `count` 是写完后的滚动条数，正好对上提示里那行 `# 滚动摘要（N/80 条）`。
- `archived > 0` 表示这次写入挤掉了旧条目，已落到 `archive/<预设名>/YYYY-MM-DD.md`。
- 空 `summary` 直接抛错，不会写进半条空记录。

四份记忆的写工具名字互不相同，所以即使四个预设同时活跃也不会互相污染 —— 
`verify-memory-isolation.mjs` 会让每个工具各写一笔，断言只有自己的文件变了。

## 每轮先看什么

人设最开头：

```
【每轮先看 · 本预设记忆 + 当前会话上下文】
{{whale_memory}}
```

每轮开口前必须看 ①**本预设自己的记忆文件** ②**当前会话的上下文**（原文或压缩摘要）。
**只看自己这一份**，绝不读/写其他预设的记忆。

压缩由 `billion-context` 插件负责（本插件不挂 history-window）；人设的约定是：
摘要也是依据、需要原文时用 `search_context` / `decompress` 自己去找。

## 为什么是「提示变量」而不是 section（这是踩过的坑）

`@deepseek-ai/dsh-system-prompt` 的 `assemble()` 末尾：

```js
sections: completeSection === void 0 ? transformed.sections : [completeSection]
```

**只要组合里存在一个 `complete: true` 的 section，最终提示就只剩它一个**，其余 section 全丢。
本插件的 persona 都沿用官方 minimal 的 `complete: true`，所以「另注册 section 放记忆」
**从来没生效过**：实测本机 34 条真实系统提示里，记忆段出现 **0 次**。

改成 `ctx.systemPrompt.variable()` 后，人设里的 `{{whale_memory}}` 会被插值替换，
记忆才真正进入模型看到的提示。`verify-memory-injection.mjs` 同时证明两件事：
变量通道有效、section 通道确实是死路。

## 上限是怎么保证的（两道保险）

1. **注入时收口** —— `composeMemory()` 永远只取最近 `turnLimit`（80）条滚动摘要。
   即使文件里堆了 500 条，进到上下文里的也只有 80 条。
2. **落盘时裁剪** —— `appendRolling()` / `pruneMemoryFile()` 会把文件本身裁到 80 条并自动归档。
   写盘是显式动作，组装提示的热路径不会偷偷写文件。

总长顶到 `maxChars`（16000）时，先丢最旧的滚动摘要，再丢详细区，**固定记忆最后才动**。

## 兼容性

- 旧格式文件（没有任何新分区标题）整篇按「固定记忆」解析，**一条都不会丢**。
- 文件标题与 `>` 引用行注入时剥掉；没写内容的空小节也丢掉，
  所以只有骨架时既不占上下文，也不会让小鱼误以为「记忆里有内容」。

## 自检

```bash
node verify-memory-injection.mjs   # 变量通道有效 / section 通道被丢弃
node verify-memory-tool.mjs        # 写入工具可用：编号、计数、落盘、详细区同步
node verify-memory-rolling.mjs     # 四区解析 + 80 条滚动 + 归档 + 旧格式兼容
node verify-memory-isolation.mjs   # 四个文件互不相通（读 + 写都验）
node verify-memory-archive.mjs     # 超 80 条自动归档、四个归档目录互不覆盖
node verify-live-assembly.mjs      # 用真实 patch + 真实记忆文件复刻宿主装配
node smoke-memory.mjs              # 变量与工具的注册形态 / 读盘即时生效
node verify-patch.mjs cordis.patch.yml   # patch 里的 variableName/toolName/turnLimit 与规则文案
```

CI（`.github/workflows/release.yml`）在 tag 上会把这些都跑一遍，
并对 `verify-memory-isolation` / `verify-memory-tool` / `verify-memory-rolling` /
`verify-memory-archive` / `verify-memory-injection` 额外断言「没有出现 `[skip]`，
真的执行了」—— 它们不依赖宿主库，静默跳过就说明检查退化了。
