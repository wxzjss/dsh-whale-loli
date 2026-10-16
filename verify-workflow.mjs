// 校验 .github/workflows/release.yml 的关键点，避免推到 GitHub 上才发现写错。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DSH_ROOT = 'C:/Users/35453/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh';
const yamlMod = await import(pathToFileURL(DSH_ROOT + '/node_modules/js-yaml/index.js').href);
const yaml = yamlMod.default ?? yamlMod;

const wf = yaml.load(readFileSync('.github/workflows/release.yml', 'utf8'));

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

console.log('=== workflow 结构 ===');
console.log('  name:', wf.name);
check('name 为 release', wf.name === 'release');

// on.push.tags —— YAML 会把裸 on 解析成 true，这是 yaml 1.1 的老问题
const on = wf.on ?? wf[true];
check('on 存在', Boolean(on), JSON.stringify(on));
check('push.tags 匹配 v*', JSON.stringify(on?.push?.tags) === '["v*"]', JSON.stringify(on?.push?.tags));

console.log('\n=== 权限 ===');
check('permissions.contents = read', wf.permissions?.contents === 'read');
check('permissions.id-token = write（OIDC 必需）', wf.permissions?.['id-token'] === 'write');

console.log('\n=== job / steps ===');
const job = wf.jobs?.publish;
check('jobs.publish 存在', Boolean(job));
// 注意：runs-on 必须用中括号取，写 `.runs-on` 会被当成减法
check('runs-on = ubuntu-latest', job?.['runs-on'] === 'ubuntu-latest', String(job?.['runs-on']));

const steps = job?.steps ?? [];
const runs = steps.map((s) => s.run ?? '').join('\n');
const names = steps.map((s) => s.name ?? '').join('\n');
const uses = steps.map((s) => s.uses ?? '').filter(Boolean);
console.log('  uses:', uses.join(' | '));
console.log('  steps:', steps.map((s) => s.name ?? s.uses).filter(Boolean).join(' → '));

check('用 actions/checkout@v4', uses.includes('actions/checkout@v4'));
check('用 actions/setup-node@v4', uses.some((u) => u.startsWith('actions/setup-node@v4')));
const setup = steps.find((s) => (s.uses ?? '').startsWith('actions/setup-node@v4'));
check('setup-node 配了 registry-url', setup?.with?.['registry-url'] === 'https://registry.npmjs.org');
check('Node 版本 >= 24（自带 npm>=11）', Number(setup?.with?.['node-version']) >= 24, String(setup?.with?.['node-version']));

check('显式升级 npm 到 ^12', /npm install -g npm@\^12/.test(runs));
check('打印 npm --version 便于排查', /npm --version/.test(runs));

console.log('\n=== 发布前校验 ===');
for (const s of ['verify-patch.mjs', 'verify-real-loader.mjs', 'verify-composition.mjs', 'verify-memory-isolation.mjs', 'smoke-memory.mjs']) {
  check(`跑 ${s}`, runs.includes(s));
}
check('改了 cordis.patch.yml 就 fail（git diff --exit-code）', runs.includes('git diff --exit-code cordis.patch.yml'));
// 这一步的标题写在 step.name 里，不是 run 里
check(
  '校验 tag 与 package.json 版本一致',
  names.includes('Check tag matches package.json version') && runs.includes('GITHUB_REF_NAME'),
);

console.log('\n=== 发布命令 ===');
const pub = steps.find((s) => (s.run ?? '').includes('npm publish'));
const pubCmd = pub?.run ?? '';
check('有 npm publish --access public', /npm publish --access public/.test(pubCmd), pubCmd.trim());
check('没有泄漏 NODE_AUTH_TOKEN', !('env' in (pub ?? {})));
check('未显式传 --provenance（交给 npm 判断）', !pubCmd.includes('--provenance'));

// 全局：整个 workflow 不该真的引用密钥（自身注释里提到名字不算）
const whole = readFileSync('.github/workflows/release.yml', 'utf8');
const codeOnly = whole
  .split(/\r?\n/)
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
check('代码里不含 NPM_TOKEN / NODE_AUTH_TOKEN', !/NPM_TOKEN|NODE_AUTH_TOKEN/.test(codeOnly));
check('代码里不含 secrets.', !/secrets\./.test(codeOnly));

console.log('\nRESULT:', ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
