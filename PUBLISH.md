# dsh-whale-loli 发布操作台

一次性把「npm 发布 + GitHub 开源 + 提交到 DSH 插件目录」跑完的辅助脚本。
**发布前需要你先登录**：脚本会检查登录状态，没登录就停下来并打印该怎么做。

## 前置：登录（只需做一次）

```powershell
# 1) npm 登录（浏览器会弹出授权页）
npm login

# 2) 确认登录成功，应打印你的 npm 用户名
npm whoami
```

GitHub 侧不需要额外登录：本仓库已经推到 `https://github.com/wxzjss/dsh-whale-loli`，
后续改动只需 `git push`。如果这台机器换了账号，再跑一次 `git config user.name/user.email`。

## 用法

```powershell
cd C:\Users\35453\Documents\deepseek-harness\default-workspace\dsh-whale-loli

# 只检查、不发布（推荐先跑这个）
node publish.mjs --check

# 真正发布（会先自动跑校验，再 npm publish，再 git tag + push）
node publish.mjs --yes
```

## 脚本会做什么

1. `node build-patch.mjs` + `node verify-patch.mjs cordis.patch.yml`
   —— 从 `src/persona.md` 重新生成 `cordis.patch.yml` 并校验结构。
2. `node verify-real-loader.mjs cordis.patch.yml` —— 用 DSH 真实解析器验证。
3. `node verify-composition.mjs` —— 验证 bundle 层与 profile 层组合后不重复注册。
4. 检查 `npm whoami`；未登录则退出并提示。
5. 检查 npm 上 `dsh-whale-loli` 的版本是否已被占用；已占用且版本相同则报错。
6. `npm pack --dry-run` 打印将要发布的文件清单，供你最后确认。
7. 非 `--check` 时：`npm publish --access public`。
8. 打 tag `v<version>` 并 `git push origin main --tags`。

## 为什么需要人来做

`npm publish` 必须用你的 npm 账号凭证，凭证等于账号权限，不适合由脚本代管。
本脚本刻意不接收、不存储任何 token。

---

# 提交到 DSH 插件目录（awesome-dsh-plugin）

「收录进插件市场」= 向 `awesome-dsh-plugin/awesome-dsh-plugin` 提一个 PR，
只加**一个文件**：`data/plugins/wxzjss__dsh-whale-loli.yml`（注意文件名是双下划线）。
内容已经写好在本仓库的 `catalog-entry.yml`，本地自查也备好了。

> ⚠️ **不要改 README.md。** 目录仓库的两个 README 是脚本生成的，
> 清单数据在 `data/plugins/`，一个插件一个 YAML 文件（contributing.md 第 7 行）。

## 条目格式（对照真实条目）

```yaml
url: https://github.com/wxzjss/dsh-whale-loli
name: wxzjss/dsh-whale-loli
category: identity
description:
  en: '...'   # 必填，以句号结尾
  zh: '...'   # 可选
```

- 字段顺序固定为 `url, name, category, description`
- 描述里含 `": "` 必须加引号（否则 YAML 误解析）
- **不要手写 `npm:` 键**——npm 映射由 registry 自动采集，手写会被校验拒绝（第 212 行）
- `identity` 分类的正式标题是 **Identity & Communication**；同类的先例有
  `Awoodwhale/dsh-agent-persona`、`HerTa-st/Herta-dsh`、`BOWLUNA/dsh-custom-mode`

## 收录门槛（来自 contributing.md，2026-10-16 逐条核对原文）

| 门槛 | 本仓库状态 |
| --- | --- |
| `package.json` 声明 `dsh.bundle`（只声明 `dsh.client` 不算，是最常见的被拒原因） | ✅ `./cordis.patch.yml` |
| 真实可用的代码，非占位/纯 README 仓库 | ✅ 人设 + patch + 8 个校验脚本 |
| 仓库创建满 1 天（**没有提交数门槛**） | ⏳ 建仓于 2026-10-16 13:44 UTC，**2026-10-17 13:44 UTC 之后可提** |
| 仓库带 `dsh-plugin` topic | ✅ 已加 |
| `category` 取值合法（23 个可选值） | ✅ `identity` |
| 描述只说功能、无营销词、且**必须属实**（夸大是最主要的打回原因） | ✅ 已按源码逐项核对 |
| 一个 PR 最多 3 条 | ✅ 本 PR 只有 1 条 |
| peerDependencies 不带预发布坑 | ✅ `verify-peers.mjs` 对 registry 全量版本 0 漏 |

npm 发布与收录**互不影响**（第 207 行：`listing is unaffected either way`），
但发了 npm 后店面能显示下载量。

## 本地自查

```powershell
node verify-listing.mjs --topics=agent-preset,deepseek-harness,dsh,dsh-plugin,persona
node verify-peers.mjs
```

## 推送与提 PR

本机 `github.com:443` 不通（`api.github.com` 正常），所以 `git push` 会失败。
提交走 GitHub REST API，脚本已经封装好：

```powershell
# 把本地未推送的提交同步到 GitHub（逐文件 Contents API 提交）
node submit-listing.mjs --local-only

# 满 1 天后，连带 fork 目录仓库、建分支、开 PR 一次跑完
node submit-listing.mjs
```

PR 的 CI 检查顺序（contributing.md 156–163）：条目数 ≤3 → `dsh.bundle` → 仓库 1 天龄 →
`awesome-lint` + site build。CI 全绿只是前提，最终由维护者读一遍你的仓库才合并。

再往后若 `github.com` 恢复，正常 `git push origin main` 即可；
两侧内容已经一致（`submit-listing.mjs` 会比对内容，一致的文件不会重复提交）。


