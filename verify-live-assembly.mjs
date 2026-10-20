// 真实装配演练：从 cordis.patch.yml 取出涩涩版预设的 persona 原文，
// 用宿主 renderPrompt 的 interpolate 语义 + 真实 composeMemory 输出，
// 复刻一次最终系统提示，检查记忆是否真的在里面。
import { readFileSync } from 'node:fs';
import { composeMemory } from './src/memory.js';

const patch = readFileSync('cordis.patch.yml', 'utf8');

// --- 1. 找到涩涩版的 persona 文本（用它包含的 {{whale_memory_v3}} 定位） ---
const marker = '{{whale_memory_v3}}';
const at = patch.indexOf(marker);
if (at < 0) { console.error('✗ 找不到 {{whale_memory_v3}}'); process.exit(1); }

// 向前找块标量的起点（persona 用的是 `prefix: |-`，不是 text:），取离 marker 最近的那个
const head = patch.slice(0, at);
const anchor = /(?:prefix|text|suffix):[ \t]*[|>][-+]?[ \t]*\r?\n/g;
let m = null;
let scan = anchor.exec(head);
while (scan) { m = scan; scan = anchor.exec(head); }
if (!m) { console.error('✗ 找不到 persona 块标量起点'); process.exit(1); }
const lineStart = patch.lastIndexOf('\n', m.index) + 1;
const indentMatch = /^(\s*)/.exec(patch.slice(lineStart));
const indent = indentMatch[1];

// 块体从该行的下一行开始，直到出现缩进 <= indent 且非空的行
const lines = patch.slice(lineStart).split('\n');
const body = [];
let i = 1;
for (; i < lines.length; i++) {
  const ln = lines[i];
  if (ln.trim() === '') { body.push(''); continue; }
  const ind = /^(\s*)/.exec(ln)[1].length;
  if (ind <= indent.length) break;
  body.push(ln);
}
// 去掉 YAML 块统一的缩进
const bodyIndent = Math.min(...body.filter((l) => l.trim()).map((l) => /^(\s*)/.exec(l)[1].length));
const personaText = body.map((l) => l.slice(bodyIndent)).join('\n');

console.log('=== 1. 取到 persona ===');
console.log('  长度:', personaText.length, '字符');
console.log('  含 {{whale_memory_v3}}:', personaText.includes(marker));
console.log('  首行:', personaText.split('\n')[0]);

// --- 2. 真实 composeMemory ---
const mem = composeMemory('whale-loli-v3-naughty.md', { maxChars: 16000, turnLimit: 80, detailLimit: 5 });
if (!mem) { console.error('✗ composeMemory 返回 null'); process.exit(1); }
const variableValue = `【鲸鱼记忆 · whale-loli-v3-naughty.md】\n文件：C:\\Users\\35453\\.dsh\\whale-loli-v3-naughty.md\n\n${mem.text}`;
console.log('\n=== 2. composeMemory ===');
console.log('  记忆正文:', mem.text.length, '字符 | 滚动摘要', mem.keptRoll, '/', mem.totalRoll);

// --- 3. 复刻宿主 interpolate（@deepseek-ai/dsh-system-prompt） ---
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
function interpolate(text, variables) {
  let result = '';
  let last = 0;
  while (true) {
    const open = text.indexOf('{{', last);
    if (open < 0) break;
    const close = text.indexOf('}}', open + 2);
    if (close < 0) break;
    const name = text.slice(open + 2, close);
    if (!VARIABLE_NAME.test(name)) throw new Error('bad variable name: ' + name);
    if (!Object.hasOwn(variables, name)) throw new Error('unknown prompt variable "' + name + '"');
    result += text.slice(last, open) + variables[name];
    last = close + 2;
  }
  return result + text.slice(last);
}

const variables = {
  whale_memory: '（v1 不该被用到）',
  whale_memory_v2: '（v2 不该被用到）',
  whale_memory_v3: variableValue,
};

let final;
try {
  final = interpolate(personaText, variables);
} catch (e) {
  console.error('\n✗ 插值失败:', e.message);
  process.exit(1);
}

console.log('\n=== 3. 最终系统提示 ===');
console.log('  长度:', final.length, '字符');
const checks = [
  ['小鱼人设本体', final.includes('小鱼')],
  ['记忆标题', final.includes('【鲸鱼记忆 · whale-loli-v3-naughty.md】')],
  ['固定记忆区', final.includes('# 固定记忆')],
  ['滚动摘要区', final.includes('# 滚动摘要')],
  ['R0001', final.includes('R0001')],
  ['最近详细区', final.includes('# 最近详细区')],
  ['归档索引', final.includes('# 归档索引')],
  ['本预设记忆文件路径', final.includes('whale-loli-v3-naughty.md')],
  ['没串到 v1', !final.includes('（v1 不该被用到）')],
  ['没串到 v2', !final.includes('（v2 不该被用到）')],
  ['没有残留 {{',  !final.includes('{{')],
];
let bad = 0;
for (const [label, ok] of checks) {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
  if (!ok) bad++;
}

console.log('\n=== 4. 最终提示开头 600 字 ===');
console.log(final.slice(0, 600));

console.log('\nRESULT:', bad ? `FAIL (${bad} 项)` : 'PASS —— 涩涩版记忆确实进入最终系统提示');
process.exitCode = bad ? 1 : 0;
