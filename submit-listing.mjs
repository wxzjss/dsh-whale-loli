#!/usr/bin/env node
/**
 * 把本地 commit 推上 GitHub，并（可选）向 awesome-dsh-plugin 提 listing PR。
 *
 *   node submit-listing.mjs --local-only
 *       只做本地能做的：把 catalog-entry.yml 复制成标准的条目文件、
 *       用 GitHub Contents API 把本地未推送的提交送上去。
 *
 *   node submit-listing.mjs
 *       完整流程：先同步本地提交，再 fork 目录仓库、建分支、提交条目、开 PR。
 *
 * 为什么不用 `git push`：本机 github.com:443 连不上（api.github.com 正常），
 * 所以改用 GitHub REST 的 Contents/Git Data API 写内容。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { glab, readToken, b64, unb64 } from './lib/github.mjs';

/** 算出 git blob 的 sha（与 git hash-object 一致），用于跳过没变的文件。 */
function gitBlobSha(content) {
  const buf = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

const ROOT = new URL('./', import.meta.url);
const REPO = 'wxzjss/dsh-whale-loli';
const CATALOG = 'awesome-dsh-plugin/awesome-dsh-plugin';
const BRANCH = 'main';
const ENTRY_PATH = 'data/plugins/wxzjss__dsh-whale-loli.yml';
const localOnly = process.argv.includes('--local-only');
const perFile = process.argv.includes('--per-file');

/**
 * 需要同步到 GitHub 的文件 → 内容。
 *
 * 必须先问 git 要**已入库的 blob**，不能直接读工作区文件：`.gitattributes` 里
 * `* text=auto eol=lf` 让 git 一律按 LF 入库，而 Windows 工作区里可能是 CRLF。
 * 早先这里读的是工作区字节，于是 CRLF 被原样推上 GitHub —— 远端 blob 的 sha
 * 与 `git rev-parse HEAD:path` 对不上（v0.3.0 的 src/persona-v3-naughty.md 就是
 * 这么岔开的：远端 6241 B / CRLF，git 里 6185 B / LF）。
 *
 * `git show HEAD:<path>` 拿到的东西，和 `git ls-files` 列出的路径一一对应，
 * 也正是 GitHub 上应该有的字节。没有 git（或文件未入库）时退回读盘。
 */
function read(...p) {
  const rel = p.join('/');
  const url = new URL('./' + rel, ROOT);
  if (!existsSync(url)) return null;
  try {
    return execFileSync('git', ['show', `HEAD:${rel}`], {
      cwd: fileURLToPath(ROOT),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return readFileSync(url, 'utf8');
  }
}

/**
 * 同步清单：从 git 索引动态取（而不是手写死列表，免得新增文件漏传）。
 * 拿不到 git（比如没有 .git）时退回内置列表。
 *
 * 注意：只排除 `.git/` 目录本身，**不要**用 `.startsWith('.git')` —— 那会把
 * `.gitignore` / `.gitattributes` 这类点文件一起滤掉，导致远端缺文件。
 */
function collectFiles() {
  try {
    const tracked = execFileSync('git', ['ls-files'], { cwd: fileURLToPath(ROOT), encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((p) => p !== '.git' && !p.startsWith('.git/'))
      .sort();
    if (tracked.length > 0) {
      return Object.fromEntries(tracked.map((p) => [p, read(...p.split('/'))]));
    }
  } catch {
    // 落到下面的静态列表
  }
  return Object.fromEntries(
    [
      '.gitattributes', '.gitignore',
      'PUBLISH.md', 'README.md', 'package.json', 'listing.json', 'catalog-entry.yml',
      'build-patch.mjs', 'prove-collision.mjs', 'publish.mjs', 'smoke-memory.mjs',
      'submit-listing.mjs', 'verify-composition.mjs', 'verify-listing.mjs',
      'verify-live-runtime.mjs', 'verify-memory-isolation.mjs', 'verify-patch.mjs',
      'verify-peers.mjs', 'verify-real-loader.mjs',
      'src/index.js', 'src/memory.js', 'src/persona.md', 'src/persona-v2-live.md',
      'src/persona-v3-naughty.md',
      'cordis.patch.yml', 'lib/github.mjs', 'lib/dsh-root.mjs',
    ].map((p) => [p, read(...p.split('/'))]),
  );
}

const FILES = collectFiles();

/** 把内容写到远端分支（存在则更新，不存在则新建），逐个文件一次提交。 */
async function pushFile(path, content, message) {
  let sha;
  try {
    const cur = await glab(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
    sha = cur.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const out = await glab(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: {
      message,
      content: b64(content),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    },
  });
  return out.commit.sha.slice(0, 7);
}

async function syncLocalCommits() {
  console.log('=== 用 Contents API 同步本地未推送的文件 ===');
  for (const [path, content] of Object.entries(FILES)) {
    if (content === null) continue;
    // 内容一致就跳过，避免打无意义的提交
    let remote = null;
    try {
      const cur = await glab(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
      remote = unb64(cur.content);
    } catch (e) { if (e.status !== 404) throw e; }
    if (remote === content) {
      console.log(`  = ${path} (已是最新)`);
      continue;
    }
    const sha = await pushFile(path, content, `chore: sync ${path} via Contents API`);
    console.log(`  ✓ ${path} -> ${sha}`);
  }
  // 同样要处理「本地已删、远端还在」的文件（这条路径只做增改，见 syncAtomic 的说明）。
  const localPaths = new Set(Object.keys(FILES).filter((p) => FILES[p] !== null));
  let remotePaths = [];
  try {
    const tree = await glab(`/repos/${REPO}/git/trees/${BRANCH}?recursive=1`);
    remotePaths = tree.tree.filter((n) => n.type === 'blob').map((n) => n.path);
  } catch (e) {
    console.warn(`  （拿不到远端文件树，跳过删除检查：${e.message}）`);
    return;
  }
  for (const p of remotePaths.filter((x) => !localPaths.has(x)).sort()) {
    try {
      const cur = await glab(`/repos/${REPO}/contents/${p}?ref=${BRANCH}`);
      await glab(`/repos/${REPO}/contents/${p}`, {
        method: 'DELETE',
        body: { message: `chore: 删除 ${p}（本地已移除）`, sha: cur.sha, branch: BRANCH },
      });
      console.log(`  ✗ ${p}（本地已删除，从远端移除）`);
    } catch (e) {
      console.warn(`  ! 删不掉 ${p}: ${e.message}`);
    }
  }
}

/**
 * 一次性把所有文件写进**同一个** commit（Git Trees API）。
 *
 * 为什么需要它：逐个文件 PUT 会产生 N 个提交，中途每个提交都是一个「部分修好」
 * 的状态 —— 于是给 tag 挑 commit 时极易挑到只修了一半的那个（v0.2.0 就栽在这里：
 * tag 指向的树里 release.yml 已是新版，verify-patch.mjs 还是硬编码旧版，CI 照挂）。
 * 用这个函数同步，远端 HEAD 的任何一版都是自洽的。
 *
 * 返回新 commit 的完整 sha。
 */
async function syncAtomic() {
  console.log('=== 用 Git Trees API 一次性同步（单提交，避免半吊子状态）===');

  // 同步的是**已提交**的内容（`git show HEAD:<path>`）。工作区若有未提交改动，
  // 说明作者眼前看到的东西和将要推上去的不是一回事 —— 那是静默推旧内容，必须拦下。
  // 想推工作区现状就先 `git add -A && git commit`。
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], {
      cwd: fileURLToPath(ROOT),
      encoding: 'utf8',
    }).trim();
    if (dirty !== '') {
      console.error('\n工作区有未提交改动，同步的会是 HEAD 里的旧内容：\n' + dirty);
      console.error('先 commit 再同步，否则 GitHub 上的源码和本地不一致。');
      process.exit(1);
    }
  } catch (e) {
    if (e.status === 1) throw e;
    console.warn('  （拿不到 git status，跳过干净检查）');
  }

  // 1. 当前 HEAD
  const headRef = await glab(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const headSha = headRef.object.sha;
  const head = await glab(`/repos/${REPO}/git/commits/${headSha}`);
  console.log(`  当前 HEAD: ${headSha.slice(0, 7)}`);

  // 2. 远端已有的 blob sha（用来跳过没变的文件）
  const remoteTree = await glab(`/repos/${REPO}/git/trees/${head.tree.sha}?recursive=1`);
  const remoteBlobs = new Map(remoteTree.tree.filter((n) => n.type === 'blob').map((n) => [n.path, n.sha]));

  // 3. 只为变了的文件建 blob
  const entries = [];
  let changed = 0;
  for (const [path, content] of Object.entries(FILES)) {
    if (content === null) continue;
    const localSha = gitBlobSha(content);
    if (remoteBlobs.get(path) === localSha) {
      console.log(`  = ${path}`);
      continue;
    }
    const blob = await glab(`/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: { content: b64(content), encoding: 'base64' },
    });
    entries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    console.log(`  ↑ ${path}`);
    changed++;
  }

  // 3b. 删掉远端有、本地已经没有的文件。
  //
  // Trees API 的 base_tree 是「继承」，entries 里没写到的路径会原样留在新树里 ——
  // 也就是说 `git rm` 一个文件之后，远端那份**永远删不掉**。
  // v0.9.16 就是这么出的事：本地删掉了 src/affinity.js 和 src/daemon.js，
  // 远端 commit 里它们还在；CI 检出该 commit 后 `files: ["src"]` 又把这两个
  // 陈旧的死代码打进 npm 包（包 65 KB 时里面还躺着 40 KB 的已删模块）。
  // 所以这里按「本地入库文件清单」对照远端树，把多出来的 blob 用 sha:null 移除。
  const localPaths = new Set(Object.keys(FILES).filter((p) => FILES[p] !== null));
  const stale = [...remoteBlobs.keys()].filter((p) => !localPaths.has(p)).sort();
  if (stale.length > 0) {
    for (const p of stale) entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
    changed += stale.length;
    for (const p of stale) console.log(`  ✗ ${p}（本地已删除，从远端移除）`);
  } else {
    console.log('  远端没有多余文件。');
  }

  if (changed === 0) {
    console.log('  没有变化，远端已是最新。');
    return headSha;
  }

  // 4. 建新 tree（基于原 tree，整体替换这些路径）
  const tree = await glab(`/repos/${REPO}/git/trees`, {
    method: 'POST',
    body: { base_tree: head.tree.sha, tree: entries },
  });

  // 5. 建 commit
  const commit = await glab(`/repos/${REPO}/git/commits`, {
    method: 'POST',
    body: {
      message: process.env.SYNC_MESSAGE || 'chore: sync plugin files (atomic)',
      tree: tree.sha,
      parents: [headSha],
    },
  });

  // 6. 移动分支
  await glab(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });

  console.log(`  ✓ 新 commit: ${commit.sha.slice(0, 7)}`);
  return commit.sha;
}

/** 目录 CI 的硬门槛：仓库创建满 1 天。不满就明确报错，而不是去开一个必被拒的 PR。 */
async function assertRepoAge() {
  const repo = await glab(`/repos/${REPO}`);
  const ageMs = Date.now() - new Date(repo.created_at).getTime();
  const ONE_DAY = 86400_000;
  if (ageMs < ONE_DAY) {
    const left = ONE_DAY - ageMs;
    const h = Math.floor(left / 3600_000);
    const m = Math.round((left % 3600_000) / 60_000);
    throw new Error(
      `仓库创建于 ${repo.created_at}，还差 ${h} 小时 ${m} 分才满目录要求的 1 天。\n` +
      `  到点后再跑一次本脚本即可（内容已就绪，不会丢）。`,
    );
  }
  console.log(`  ✓ 仓库年龄达标（${(ageMs / ONE_DAY).toFixed(2)} 天）`);
}

async function submitPr() {
  console.log('\n=== 向目录仓库提 listing PR ===');
  await assertRepoAge();

  // 1. fork（已 fork 则复用）
  const owner = 'wxzjss';
  const forkFull = `${owner}/awesome-dsh-plugin`;
  try {
    await glab(`/repos/${REPO}/forks/${CATALOG}`, { method: 'POST' });
  } catch { /* 多半是已经 fork 过了 */ }
  // 等 fork 就绪
  for (let i = 0; i < 20; i++) {
    try { await glab(`/repos/${forkFull}`); break; } catch { await new Promise((r) => setTimeout(r, 3000)); }
  }
  console.log(`  fork: ${forkFull}`);

  // 2. 从 fork 的 main 建分支
  const base = await glab(`/repos/${forkFull}/git/ref/heads/main`);
  const baseSha = base.object.sha;
  const branch = 'add-dsh-whale-loli';
  try { await glab(`/repos/${forkFull}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: baseSha } }); } catch { /* 已存在 */ }

  // 3. 写条目文件
  const entry = readFileSync(new URL('./catalog-entry.yml', ROOT), 'utf8');
  let curSha;
  try { curSha = (await glab(`/repos/${forkFull}/contents/${ENTRY_PATH}?ref=${branch}`)).sha; } catch { /* 新文件 */ }
  await glab(`/repos/${forkFull}/contents/${ENTRY_PATH}`, {
    method: 'PUT',
    body: {
      message: `Add ${owner}/dsh-whale-loli`,
      content: b64(entry),
      branch,
      ...(curSha ? { sha: curSha } : {}),
    },
  });
  console.log(`  ✓ 写入 ${ENTRY_PATH}`);

  // 4. 开 PR
  const pr = await glab(`/repos/${CATALOG}/pulls`, {
    method: 'POST',
    body: {
      title: `Add ${owner}/dsh-whale-loli`,
      head: `${owner}:${branch}`,
      base: 'main',
      body: [
        'Adds one entry, `data/plugins/wxzjss__dsh-whale-loli.yml`.',
        '',
        '- repo: https://github.com/wxzjss/dsh-whale-loli',
        '- category: `identity`',
        '- `package.json` declares `dsh.bundle` (`./cordis.patch.yml`)',
        '- repo has the `dsh-plugin` topic',
        '- npm: https://www.npmjs.com/package/dsh-whale-loli',
      ].join('\n'),
    },
  });
  console.log(`  ✓ PR #${pr.number}: ${pr.html_url}`);
  return pr;
}

// 默认走原子同步（单提交）。--per-file 用旧的逐文件方式。
if (!perFile) {
  await syncAtomic();
} else {
  await syncLocalCommits();
}
if (localOnly) {
  console.log('\n--local-only：跳过 PR 步骤。');
} else {
  await assertRepoAge().catch((e) => {
    console.error(`\n✗ 还不能提 PR：${e.message}`);
    process.exitCode = 2;
    return null;
  });
  if (process.exitCode !== 2) await submitPr();
}
