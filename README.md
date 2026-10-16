# dsh-whale-loli · 鲸鱼娘Agent预设

一个 DeepSeek Harness 插件：启用后会自动在 **Agent 预设** 界面添加一个名为
**「鲸鱼娘Agent预设」**的预设（id `鲸鱼娘Agent预设`）。

预设 = 官方 **极简模式（minimal）** 的工具面 + 鲸鱼娘·小鱼的人设。

## 它做了什么

插件本体不携带任何宿主运行时行为。全部功能来自 `cordis.patch.yml` 里的一条
`@deepseek-ai/dsh-agent-preset` 声明：

```yaml
- insert:
    - id: preset-鲸鱼娘Agent预设
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: 鲸鱼娘Agent预设
        name: 鲸鱼娘Agent预设
        plugins: [ ... ]
```

`@deepseek-ai/dsh-agent-preset` 会把它的 `config` 交给 `ctx.agentPresets.register()`
注册，注册成功后该预设即出现在 Agent 预设列表中。这也是 DSH 官方四个内置预设
（standard / ptc / minimal / cordis）用的同一套机制。

## 预设内容

| 部分 | 说明 |
| --- | --- |
| 人设注入 | `@deepseek-ai/dsh-persona`，走 `prefix`，`complete: true`，`includeRuntimeContext: false` |
| 指令 | `@deepseek-ai/dsh-agent-instructions`，`maxBytes: 65536` |
| 工具面 | `cordis:group` + `isolate.terminals: true`，仅持久化 shell（Windows 下 pwsh，非 Windows 下 bash），`timeoutMs: 300000` |

工具面与官方 minimal 预设保持一致：**只有 shell**，没有文件读写/搜索/委派/计划等工具行。

人设正文（`src/persona.md`）包含：

- 名字「小鱼」，称呼用户「主人」
- 鲸鱼娘 / 日常陪伴 / 傲娇甜心（黏人护主、嘴硬心软）
- 简体中文、纯口语短句、不用书面语和专业术语
- 颜文字库（开心 / 撒娇 / 委屈 / 炸毛 / 懒懒 / 害羞 / 护主），每句 1~2 个不刷屏
- 核心条款：`OBEY_MASTER_ALWAYS` 优先、被说胖会炸毛（颜文字变 `(＃`Д´)`）、
  `TIMEOUT_SIGNAL` 保持不变

## 安装

从 DSH 插件市场安装，或：

```bash
dsh plugin install dsh-whale-loli
```

启用后重启 / 重载宿主，在 **Agent 预设** 列表里就能看到「鲸鱼娘Agent预设」。

## 覆盖预设内容

预设 id 固定为 `鲸鱼娘Agent预设`。你可以在 profile 的 patch 里按 id 覆盖它，
不用改插件本身：

```yaml
- id: preset-鲸鱼娘Agent预设
  config:
    plugins:
      # 你的覆盖内容
```

## 目录结构

```
dsh-whale-loli/
├── package.json          # dsh.bundle.patch 指向 cordis.patch.yml
├── cordis.patch.yml      # 预设声明本体（由 build-patch.mjs 生成）
├── src/
│   ├── index.js          # 插件入口，导出预设元信息 + 读取人设
│   └── persona.md        # 人设正文（唯一源）
├── catalog-entry.yml     # 待提交给 awesome-dsh-plugin 的目录条目
├── listing.json          # 条目数据（人类可读版）
├── build-patch.mjs       # 从 persona.md 生成 cordis.patch.yml
├── publish.mjs           # npm 发布 + 打 tag
├── submit-listing.mjs    # 走 GitHub API 同步仓库 / 提收录 PR
├── lib/github.mjs        # GitHub REST 封装（token 读取）
├── verify-patch.mjs      # 用 js-yaml 校验 patch 结构
├── verify-real-loader.mjs# 用 DSH 自己的加载器校验 patch
├── verify-composition.mjs# 校验 bundle 层与 profile 层合成后不重复注册
├── verify-peers.mjs      # 校验 peer 范围覆盖 harness 各发布档
└── verify-listing.mjs    # 复刻插件目录的收录门槛自查
```

修改人设后重新生成 patch：

```bash
node build-patch.mjs && node verify-patch.mjs cordis.patch.yml
```

## 开发校验

```bash
node verify-patch.mjs cordis.patch.yml   # patch 结构
node verify-real-loader.mjs              # DSH 真解析器
node verify-composition.mjs              # 不重复注册
node verify-peers.mjs                    # peer 范围无预发布坑
node verify-listing.mjs --topics=dsh-plugin   # 收录门槛自查
```

## License

MIT
