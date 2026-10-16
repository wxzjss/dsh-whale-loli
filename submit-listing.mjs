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
import { gh } from './lib/github.mjs';

const ROOT = new URL('./', import.meta.url);
const REPO = 'wxzjss/dsh-whale-loli';
const CATALOG = 'awesome-dsh-plugin/awesome-dsh-plugin';
const BRANCH = 'main';
const ENTRY_PATH = 'data/plugins/wxzjss__dsh-whale-loli.yml';
const localOnly = process.argv.includes('--local-only');

/** 需要同步到 GitHub 的文件 → 内容。 */
const FILES = {
  'package.json': readFileSync(new URL('./package.json', ROOT), 'utf8'),
  'listing.json': existsSync(new URL('./listing.json', ROOT)) ? readFileSync(new URL('./listing.json', ROOT), 'utf8') : null,
  'catalog-entry.yml': readFileSync(new URL('./catalog-entry.yml', ROOT), 'utf8'),
  'verify-peers.mjs': readFileSync(new URL('./verify-peers.mjs', ROOT), 'utf8'),
  'verify-listing.mjs': readFileSync(new URL('./verify-listing.mjs', ROOT), 'utf8'),
  'lib/github.mjs': readFileSync(new URL('./lib/github.mjs', ROOT), 'utf8'),
  'submit-listing.mjs': readFileSync(new URL('./submit-listing.mjs', ROOT), 'utf8'),
};

/** 把内容写到远端分支（存在则更新，不存在则新建），逐个文件一次提交。 */
async function pushFile(path, content, message) {
  let sha;
  try {
    const cur = await gh(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
    sha = cur.sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const out = await gh(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
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
      const cur = await gh(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`);
      remote = Buffer.from(cur.content, 'base64').toString('utf8');
    } catch (e) { if (e.status !== 404) throw e; }
    if (remote === content) {
      console.log(`  = ${path} (已是最新)`);
      continue;
    }
    const sha = await pushFile(path, content, `chore: sync ${path} via Contents API`);
    console.log(`  ✓ ${path} -> ${sha}`);
  }
}

async function submitPr() {
  console.log('\n=== 向目录仓库提 listing PR ===');
  // 1. fork（已 fork 则复用）
  let fork;
  try {
    fork = await gh(`/repos/${REPO}/forks/${CATALOG}`, { method: 'POST' });
  } catch {
    fork = null;
  }
  const owner = 'wxzjss';
  const forkFull = `${owner}/awesome-dsh-plugin`;
  // 等 fork 就绪
  for (let i = 0; i < 20; i++) {
    try { await gh(`/repos/${forkFull}`); break; } catch { await new Promise((r) => setTimeout(r, 3000)); }
  }
  console.log(`  fork: ${forkFull}`);

  // 2. 从 fork 的 main 建分支
  const base = await gh(`/repos/${forkFull}/git/ref/heads/main`);
  const baseSha = base.object.sha;
  const branch = 'add-dsh-whale-loli';
  try { await gh(`/repos/${forkFull}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: baseSha } }); } catch { /* 已存在 */ }

  // 3. 写条目文件
  const entry = readFileSync(new URL('./catalog-entry.yml', ROOT), 'utf8');
  let curSha;
  try { curSha = (await gh(`/repos/${forkFull}/contents/${ENTRY_PATH}?ref=${branch}`)).sha; } catch { /* 新文件 */ }
  await gh(`/repos/${forkFull}/contents/${ENTRY_PATH}`, {
    method: 'PUT',
    body: {
      message: `Add ${owner}/dsh-whale-loli`,
      content: Buffer.from(entry, 'utf8').toString('base64'),
      branch,
      ...(curSha ? { sha: curSha } : {}),
    },
  });
  console.log(`  ✓ 写入 ${ENTRY_PATH}`);

  // 4. 开 PR
  const pr = await gh(`/repos/${CATALOG}/pulls`, {
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
  await submitPr();
}
