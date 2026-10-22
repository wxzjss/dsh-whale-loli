#!/usr/bin/env node
/**
 * 检查「要发到 npm 的那个包」到底装了些什么。
 *
 *   node verify-package-files.mjs
 *
 * 为什么需要它：0.9.16 的 npm 包里躺着一个已经删掉的模块。
 *
 *   本地 `git rm src/affinity.js src/daemon.js` → 本地 `npm pack` 干净（15 个文件）
 *   → 但 `submit-listing.mjs` 用 Trees API 同步时 `base_tree` 是「继承」，
 *     远端 commit 里这两个文件原样留着 → CI 检出该 commit，`files: ["src"]`
 *     把整个 src 目录打进包 → 65 KB 的包里 40 KB 是死代码。
 *
 * 也就是说「本地 pack 干净」并不能证明「上游发出来的包干净」——两者用的不是
 * 同一棵树。这条脚本守的是本地这一侧：**package.json 的 files 白名单里
 * 不许出现已从 git 索引删除的路径，src/ 下每个 .js 都必须被别处引用**
 * （孤立模块 = 忘了删的残留，正是 affinity.js 的形态）。
 *
 * 不测网络、不测 npm registry，随时可跑。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const results = [];
function check(ok, msg) {
  results.push({ ok, msg });
  console.log(`${ok ? '✓' : '✗'} ${msg}`);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const files = pkg.files ?? [];

// ── 1. files 白名单不许指向不存在的路径 ───────────────────────────────
for (const entry of files) {
  const abs = join(ROOT, entry);
  check(existsSync(abs), `files 里的 ${entry} 确实存在`);
}

// ── 2. src/ 下每个 .js 都必须被别处 import ──────────────────────────
/** 递归列出目录下所有文件（不含 .git）。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const srcDir = join(ROOT, 'src');
check(existsSync(srcDir), 'src/ 目录存在');

const srcModules = existsSync(srcDir)
  ? readdirSync(srcDir)
      .filter((n) => n.endsWith('.js') || n.endsWith('.mjs'))
      .sort()
  : [];

// 所有 .js / .mjs（含 lib/、根目录脚本）的源码，用来找引用
const allCode = walk(ROOT)
  .filter((p) => !p.includes(`${sep}node_modules${sep}`) && !p.includes(`${sep}.git${sep}`))
  .filter((p) => p.endsWith('.js') || p.endsWith('.mjs'))
  .map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));

for (const name of srcModules) {
  const self = join(srcDir, name);
  const others = allCode.filter((c) => c.path !== self);
  // 引用形式：'./memory.js' / "../src/memory.js" / "dsh-whale-loli/memory"
  const bare = name.replace(/\.(m?js)$/, '');
  const referenced = others.some(
    (c) => c.text.includes(`./${name}`) || c.text.includes(`/${name}`) || c.text.includes(`/${bare}"`) || c.text.includes(`/${bare}'`),
  );
  check(referenced, `src/${name} 被别处引用（不是孤立死模块）`);
}

// ── 3. exports 指向的文件都在 ────────────────────────────────────────
for (const [key, target] of Object.entries(pkg.exports ?? {})) {
  if (typeof target !== 'string') continue;
  check(existsSync(join(ROOT, target)), `exports["${key}"] → ${target} 存在`);
}

// ── 4. 不许出现已被删掉的模块名（防止回潮）───────────────────────────
const GONE = ['affinity.js', 'daemon.js', 'client.js'];
const srcNames = new Set(existsSync(srcDir) ? readdirSync(srcDir) : []);
for (const gone of GONE) {
  check(!srcNames.has(gone), `已删除的 src/${gone} 没有被加回来`);
}
check(!existsSync(join(ROOT, 'lib', 'client.js')), '已删除的 lib/client.js 没有被加回来');

// ── 5. 包体量合理（防止老文件又被带进去）────────────────────────────
const srcBytes = srcModules.reduce((n, f) => n + statSync(join(srcDir, f)).size, 0);
const personae = ['persona.md', 'persona-v2-live.md', 'persona-v3-naughty.md', 'persona-v4-daughter.md'];
const personaBytes = personae.reduce(
  (n, f) => n + (existsSync(join(srcDir, f)) ? statSync(join(srcDir, f)).size : 0),
  0,
);
check(srcBytes < 120_000, `src/ 下代码总量 ${srcBytes} 字节 < 120 KB（含没删干净的残留就会超）`);
check(srcModules.length === 4, `src/ 下 .js 恰好 4 个（index / memory / presets / history-window），实际 ${srcModules.length}`);
check(personaBytes > 30_000, `四份人设合计 ${personaBytes} 字节（人设没被误删）`);

// ── 6. git 索引里不许有临时文件 ──────────────────────────────────────
try {
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const junk = tracked.filter((p) => /(^|\/)_[^/]*\.(txt|mjs|log)$/.test(p) || /\.(bak|orig|log|tmp)$/.test(p));
  check(junk.length === 0, junk.length === 0 ? 'git 索引里没有临时/备份文件' : `git 索引里有临时文件：${junk.join(', ')}`);
} catch {
  console.log('[skip] 没有 git，跳过索引检查');
}

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log(`RESULT: PASS —— 包内容干净（${results.length} 项）`);
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed.length}/${results.length} 项不通过`);
for (const f of failed) console.log(`  ✗ ${f.msg}`);
process.exit(1);
