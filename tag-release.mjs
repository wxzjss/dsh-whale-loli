// 给已经同步到远端的当前 HEAD 打 tag。借用 lib/github.mjs 的重试封装：
// 本机 api.github.com 的连接会间歇性超时，裸 fetch 常常一次都连不上。
//
//   node tag-release.mjs v0.9.3
//
// 走 GitHub 的两步 git-data API（不是 lightweight 的 ref 指向）：
//   1. POST /repos/:owner/:repo/git/tags      创建 annotated tag 对象
//   2. POST /repos/:owner/:repo/git/refs      把 refs/tags/<tag> 指向它
//
// 坑：第 1 步的 `object` 必须是**完整 40 字符 commit sha**，短 sha 会 422
// 「The object parameter must be exactly 40 characters」。所以先用
// /git/ref/heads/<branch> 取远端 HEAD，不能再拿本地短 sha 去凑。

import { glab } from './lib/github.mjs';

const REPO = 'wxzjss/dsh-whale-loli';
const BRANCH = 'main';

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('用法: node tag-release.mjs vX.Y.Z');
  process.exit(2);
}

const version = tag.slice(1);

console.log(`== 1. 取远端 ${BRANCH} 的 HEAD ==`);
const headRef = await glab(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
const sha = headRef.object.sha;
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`HEAD sha 不是完整 40 字符: ${sha}`);
console.log(`   HEAD = ${sha}`);

console.log(`\n== 2. 确认 package.json 的版本 == ${version} ==`);
const pkg = JSON.parse(Buffer.from((await glab(`/repos/${REPO}/contents/package.json?ref=${BRANCH}`)).content, 'base64').toString('utf8'));
if (pkg.version !== version) {
  throw new Error(`远端 package.json 版本是 ${pkg.version}，与 tag ${tag} 不一致；先同步版本再打 tag`);
}
console.log(`   package.json version = ${pkg.version} ✓`);

console.log(`\n== 3. 创建 annotated tag 对象 ==`);
let tagSha;
try {
  const created = await glab(`/repos/${REPO}/git/tags`, {
    method: 'POST',
    body: { tag, message: version, object: sha, type: 'commit' },
  });
  tagSha = created.sha;
  console.log(`   tag object = ${tagSha}`);
} catch (e) {
  // 重复执行时可能已经创建过，直接复用
  if (/already exists/i.test(e.message)) {
    tagSha = (await glab(`/repos/${REPO}/git/ref/tags/${tag}`)).object.sha;
    console.log(`   tag 已存在，复用 ${tagSha}`);
  } else {
    throw e;
  }
}

console.log(`\n== 4. 建立 refs/tags/${tag} ==`);
try {
  await glab(`/repos/${REPO}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/tags/${tag}`, sha: tagSha },
  });
  console.log(`   ✓ refs/tags/${tag} -> ${tagSha}`);
} catch (e) {
  if (/already exists|Reference already exists/i.test(e.message)) {
    // 已存在则强制指向新 tag 对象（重发同一版本号的场景）
    await glab(`/repos/${REPO}/git/refs/tags/${tag}`, {
      method: 'PATCH',
      body: { sha: tagSha, force: true },
    });
    console.log(`   ✓ refs/tags/${tag} 已重指 -> ${tagSha}`);
  } else {
    throw e;
  }
}

console.log(`\n=== DONE ===`);
console.log(`tag   : ${tag}`);
console.log(`commit: ${sha}`);
console.log(`CI 会在 tag 上自动跑 release.yml 并发布到 npm。`);
