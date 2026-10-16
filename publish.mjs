#!/usr/bin/env node
/**
 * dsh-whale-loli 发布脚本。
 *
 *   node publish.mjs --check   只做校验和体检，不发布
 *   node publish.mjs --yes     校验通过后真的 npm publish + git tag/push
 *
 * 刻意不接收、不存储任何 npm token：发布依赖你本机已经 `npm login` 过的凭证。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const checkOnly = !process.argv.includes('--yes');

const pkg = JSON.parse(readFileSync(root + 'package.json', 'utf8'));
const tag = `v${pkg.version}`;

/** 跑一条命令并把输出透传到控制台。失败即抛出。 */
function run(cmd, args, opts = {}) {
  process.stdout.write(`\n$ ${cmd} ${args.join(' ')}\n`);
  return execFileSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
}

/** 跑一条命令并捕获 stdout（用于读取 whoami / npm view 这类输出）。 */
function capture(cmd, args) {
  return execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
}

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

console.log(`=== dsh-whale-loli ${pkg.version} 发布${checkOnly ? '体检' : ''} ===`);

// ── 1. 重新生成并校验 patch ─────────────────────────────────────────────
run('node', ['build-patch.mjs']);
run('node', ['verify-patch.mjs', 'cordis.patch.yml']);
run('node', ['verify-real-loader.mjs', 'cordis.patch.yml']);
run('node', ['verify-composition.mjs']);

// ── 2. 确认工作区干净（发布内容必须等于仓库里的内容）────────────────────
const dirty = capture('git', ['status', '--porcelain']);
if (dirty !== '') {
  console.error('\n工作区有未提交改动：\n' + dirty);
  console.error('先 commit 再发布，否则 GitHub 上的源码会和 npm 包不一致。');
  process.exit(1);
}
console.log('\n✓ 工作区干净');

// ── 3. 确认 npm 已登录 ──────────────────────────────────────────────────
let who = '';
try {
  who = capture('npm', ['whoami']);
} catch {
  fail('npm 未登录。请先执行：npm login   然后 npm whoami 确认。');
}
console.log(`✓ npm 已登录为 ${who}`);

// ── 4. 确认版本没被占用 ─────────────────────────────────────────────────
let published = '';
try {
  published = capture('npm', ['view', `${pkg.name}@${pkg.version}`, 'version']);
} catch {
  published = ''; // 包或版本不存在，正常
}
if (published === pkg.version) {
  fail(`npm 上已经存在 ${pkg.name}@${pkg.version}，请先在 package.json 里升版本号。`);
}
console.log(`✓ ${pkg.name}@${pkg.version} 尚未发布`);

// ── 5. 打印将要发布的文件清单 ───────────────────────────────────────────
run('npm', ['pack', '--dry-run']);

if (checkOnly) {
  console.log('\n=== 体检通过。要真的发布，跑：node publish.mjs --yes ===');
  process.exit(0);
}

// ── 6. 发布 ─────────────────────────────────────────────────────────────
run('npm', ['publish', '--access', 'public']);

// ── 7. 打 tag 并推送 ────────────────────────────────────────────────────
run('git', ['tag', '-a', tag, '-m', `${pkg.name} ${tag}`]);
run('git', ['push', 'origin', 'main', '--tags']);

console.log(`\n✅ 发布完成：${pkg.name}@${pkg.version}`);
console.log(`   npm:    https://www.npmjs.com/package/${pkg.name}`);
console.log(`   github: https://github.com/wxzjss/${pkg.name}/releases/tag/${tag}`);
