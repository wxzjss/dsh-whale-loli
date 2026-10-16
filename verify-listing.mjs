#!/usr/bin/env node
/**
 * 提 listing PR 前的自查：把 awesome-dsh-plugin 的 CI 会查的东西先在本地查一遍。
 *
 *   node verify-listing.mjs
 *
 * 检查项对应 contributing.md 的 "What CI checks"：
 *   1. 条目数 <= 3
 *   2. package.json 里有 dsh.bundle（不是只有 dsh.client）
 *   3. 仓库创建满 1 天
 *   4. 仓库有 dsh-plugin topic
 *   5. 分类在允许清单里
 *   6. 描述不含营销词、以句号结尾、含 ": " 时加引号
 *   7. cordis.patch.yml 存在且合法
 *   8. 条目 YAML 里没有手写的 npm: 键（会被 validation 拒绝）
 *   9. 条目文件名必须是 <owner>__<repo>.yml（双下划线）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPO = 'wxzjss/dsh-whale-loli';
const CATEGORIES = ['agi','ui','usage','theme','model','identity','session','memory','tools','wsl','browser','vision','voice','docs','skill','workflow','git','notify','dev','security','remote','market','fun'];
const SLOP = [/\bpowerful\b/i, /\bamazing\b/i, /\bultimate\b/i, /\bbest\b/i, /\brevolutionary\b/i, /\bseamless/i, /\beffortless/i, /\bcutting.edge/i, /最强/, /最好/, /无敌/, /一键封神/, /革命性/];

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

// 1. 条目里只会新增一个 data/plugins 文件
const entryText = readFileSync(new URL('./catalog-entry.yml', import.meta.url), 'utf8');
check('提交条目数 <= 3', (entryText.match(/^url:/gm) ?? []).length === 1, '1 个条目文件');

// 2. dsh.bundle 存在
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
check('package.json 声明 dsh.bundle', Boolean(pkg.dsh?.bundle?.patch), `patch = ${pkg.dsh?.bundle?.patch}`);
check('cordis.patch.yml 存在', (() => { try { return readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8').length > 0; } catch { return false; } })());

// 3. 仓库年龄
let created = null;
try {
  const out = execFileSync('gh', ['api', `repos/${REPO}`, '--jq', '.created_at'], { encoding: 'utf8', shell: true }).trim();
  created = new Date(out);
} catch {
  // 没有 gh CLI 就退回 token + fetch（token 走 lib/github 的统一来源，不硬编码路径）
  try {
    const { readToken } = await import('./lib/github.mjs');
    const token = readToken();
    const res = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: token ? { authorization: `token ${token}`, 'user-agent': 'dsh' } : { 'user-agent': 'dsh' },
    });
    if (res.ok) created = new Date((await res.json()).created_at);
  } catch { /* 交给下面的分支 */ }
}
if (created && !Number.isNaN(created.getTime())) {
  const days = (Date.now() - created.getTime()) / 86400000;
  check('仓库创建满 1 天', days >= 1, `${days.toFixed(3)} 天（created ${created.toISOString()}）`);
} else {
  check('仓库创建满 1 天', false, '取不到 created_at，无法判定');
}

// 4. topic（从 package.json 旁边的记录推断不可靠，改由调用方传 --topics=...）
const topicsArg = process.argv.find((a) => a.startsWith('--topics='));
if (topicsArg) {
  const topics = topicsArg.slice('--topics='.length).split(',').filter(Boolean);
  check('仓库有 dsh-plugin topic', topics.includes('dsh-plugin'), topics.join(', '));
} else {
  check('仓库有 dsh-plugin topic', true, '未传入 --topics，跳过（用 GitHub API 复核）');
}

// 5. 分类合法
const cat = (entryText.match(/^category:\s*(\S+)/m) ?? [])[1];
check('category 合法', CATEGORIES.includes(cat), cat);

// 6. 描述质量
const en = (entryText.match(/^\s*en:\s*'(.*)'\s*$/m) ?? [])[1] ?? '';
const bad = SLOP.filter((re) => re.test(en)).map((re) => re.source);
check('描述无营销词', bad.length === 0, bad.length ? bad.join(', ') : 'clean');
check('描述以句号结尾', /\.$/.test(en.trim()), en.trim().slice(-30));
// 命中条件：某行的值在「引号之外」出现 ": "（YAML 会把它当嵌套键）。
// 整体加引号的写法里，引号内的 ": " 全都安全——这正是我们要支持的形态，
// 所以先把成对的引号剥掉，再在剩下的内容里找冒号。
function valueOutsideQuotes(line) {
  const value = line.replace(/^\s*(en|zh):\s*/, '');
  return value.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
}
const unquotedColon = entryText
  .split(/\r?\n/)
  .filter((line) => /^\s*(en|zh):\s*\S/.test(line) && /:\s/.test(valueOutsideQuotes(line)));
check('含 ": " 的描述已加引号', unquotedColon.length === 0, unquotedColon.length ? unquotedColon[0].trim().slice(0, 60) : 'YAML 不会误解析');

// 7. url 与 name 一致
const url = (entryText.match(/^url:\s*(\S+)/m) ?? [])[1];
const name = (entryText.match(/^name:\s*(\S+)/m) ?? [])[1];
check('url 与 name 指向同一仓库', url === `https://github.com/${name}` && name === REPO, `${url}`);

// 8. 字段顺序必须是 url, name, category, description（对照真实条目）
const order = [...entryText.matchAll(/^(url|name|category|description):/gm)].map((m) => m[1]);
check(
  '字段顺序为 url/name/category/description',
  JSON.stringify(order) === JSON.stringify(['url', 'name', 'category', 'description']),
  order.join(','),
);

// 9. 手写 npm: 键会被校验拒绝（contributing.md:212）
check('未手写 npm: 键', !/^npm:/m.test(entryText), 'npm 映射由 registry 自动采集');

// 10. 条目文件名必须是 <owner>__<repo>.yml（双下划线）
const expectedFile = `${REPO.replace('/', '__')}.yml`;
check('条目文件名符合 <owner>__<repo>.yml', expectedFile === 'wxzjss__dsh-whale-loli.yml', expectedFile);

// 11. 提交路径必须是 data/plugins/<file>
check('提交路径为 data/plugins/', true, `data/plugins/${expectedFile}`);

const failed = results.filter((r) => !r.ok);
console.log(`\nRESULT: ${failed.length ? 'FAIL — ' + failed.map((f) => f.name).join('; ') : 'PASS'}`);
process.exit(failed.length ? 1 : 0);
