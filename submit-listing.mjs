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
import { readFileSync, existsSync } from 'node:fs';
import { glab, readToken, b64, unb64 } from './lib/github.mjs';

const ROOT = new URL('./', import.meta.url);
const REPO = 'wxzjss/dsh-whale-loli';
const CATALOG = 'awesome-dsh-plugin/awesome-dsh-plugin';
const BRANCH = 'main';
const ENTRY_PATH = 'data/plugins/wxzjss__dsh-whale-loli.yml';
const localOnly = process.argv.includes('--local-only');

/** 需要同步到 GitHub 的文件 → 内容。 */
function read(...p) {
  const url = new URL('./' + p.join('/'), ROOT);
  return existsSync(url) ? readFileSync(url, 'utf8') : null;
}

const FILES = Object.fromEntries(
  [
    'PUBLISH.md',
    'README.md',
    'package.json',
    'listing.json',
    'catalog-entry.yml',
    'build-patch.mjs',
    'prove-collision.mjs',
    'publish.mjs',
    'submit-listing.mjs',
    'verify-composition.mjs',
    'verify-listing.mjs',
    'verify-live-runtime.mjs',
    'verify-patch.mjs',
    'verify-peers.mjs',
    'verify-real-loader.mjs',
    'src/index.js',
    'src/persona.md',
    'cordis.patch.yml',
    'lib/github.mjs',
  ].map((p) => [p, read(...p.split('/'))]),
);

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

await syncLocalCommits();
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
