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
