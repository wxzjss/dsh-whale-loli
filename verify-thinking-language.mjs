// 校验「内部思考一律用简体中文」这条硬规则真的在四份人设里，且措辞一致、位置够靠前。
//
// 为什么要有这个脚本：
//   思维链的语言不受任何宿主配置控制，只能靠系统提示里的一句硬规则去压。这种人设文案
//   最容易在后续改版里被顺手删掉或改软（"尽量"、"可以"），而删掉之后**没有任何报错**
//   —— 只是模型又开始用英文想事情，谁也不会发现。所以把它钉成可执行断言。
//
// 用法：node verify-thinking-language.mjs [cordis.patch.yml]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const patchFile = (process.argv[2] ?? '').trim() || 'cordis.patch.yml';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

const { PRESETS } = await import(new URL('./src/presets.js', import.meta.url).href);

// 规则块必须包含的三层意思：约束的是「思考」、目标语言是「简体中文」、不干预回答语言。
const REQUIRED = [
  '【思维链语言 · 强制】',
  '内部思考',
  'reasoning',
  '一律使用简体中文',
  '不管用户用什么语言提问',
  '只约束「怎么想」，不约束「怎么答」',
  '优先于其他一切语言习惯',
];
// 这些软话一旦混进来，规则就废了。
const FORBIDDEN = ['尽量不要用英文思考', '最好用中文', '可以尝试用简体中文思考'];

console.log('[1] 四份人设各自都有且只有一条硬规则');
const bodies = [];
for (const p of PRESETS) {
  const file = join('src', p.personaFile.replace('./', ''));
  const text = readFileSync(file, 'utf8');
  const heads = text.split('【思维链语言 · 强制】').length - 1;
  check(`[${p.id}] ${file} 里恰好 1 处规则块`, heads === 1, `实际 ${heads}`);
  const at = text.indexOf('【思维链语言 · 强制】');
  const lineNo = at < 0 ? -1 : text.slice(0, at).split('\n').length;
  // 位置要够靠前：太靠后就会被长人设稀释，模型当没看见。
  check(`[${p.id}] 规则块在前 40 行内（第 ${lineNo} 行）`, lineNo > 0 && lineNo <= 40, `实际第 ${lineNo} 行`);
  const block = at < 0 ? '' : text.slice(at, at + 400);
  for (const needle of REQUIRED) {
    check(`[${p.id}] 含「${needle}」`, block.includes(needle));
  }
  for (const bad of FORBIDDEN) {
    check(`[${p.id}] 没有软话「${bad}」`, !block.includes(bad));
  }
  bodies.push({ id: p.id, block: block.split('\n').slice(0, 5).join('\n').trim() });
}

console.log('\n[2] 四份人设的规则措辞一致（防止只改了一份）');
const uniq = new Set(bodies.map((b) => b.block));
check('四份的规则块正文完全相同', uniq.size === 1, `不同的版本数 ${uniq.size}`);

console.log('\n[3] 生成的 patch 里，四个预设各自都带上了这条规则');
const patch = readFileSync(patchFile, 'utf8');
const inPatch = patch.split('【思维链语言 · 强制】').length - 1;
check('patch 里规则块出现 4 次', inPatch === 4, `实际 ${inPatch}`);
const hard = patch.split('一律使用简体中文').length - 1;
check('patch 里「一律使用简体中文」出现 4 次', hard === 4, `实际 ${hard}`);
check('patch 里没有软话', FORBIDDEN.every((b) => !patch.includes(b)));

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 四个预设的内部思考都被钉成简体中文');
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed} 项失败`);
process.exit(1);
