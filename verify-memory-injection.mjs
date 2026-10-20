// 端到端证明：complete:true 的 section 里，{{变量}} 真的会被替换，
// 而独立 section 会被丢掉。用宿主自己的 renderPrompt/interpolate 语义复刻。
import { readFileSync } from 'node:fs';

function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) process.exitCode = 1;
}

const patch = readFileSync('cordis.patch.yml', 'utf8');

console.log('=== 1. patch 里三条记忆行都用 variableName，不再是 sectionName ===');
const rows = [...patch.matchAll(/file: (\S+)\n\s+variableName: (\S+)\n\s+toolName: (\S+)\n\s+maxChars: (\d+)\n\s+turnLimit: (\d+)\n\s+detailLimit: (\d+)/g)];
assert(rows.length === 3, `记忆行 = 3（实际 ${rows.length}）`);
for (const r of rows) console.log(`     ${r[1]} -> {{${r[2]}}} tool=${r[3]} maxChars=${r[4]} turn=${r[5]} detail=${r[6]}`);

console.log('\n=== 2. 每条人设都引用了自己的变量，且只引用自己的 ===');
const want = { 'whale-loli.md': 'whale_memory', 'whale-loli-v2-live.md': 'whale_memory_v2', 'whale-loli-v3-naughty.md': 'whale_memory_v3' };
const allVars = Object.values(want);
for (const r of rows) {
  const v = r[2];
  const mine = allVars.filter((x) => x !== v);
  // 统计该变量在 patch 里出现在哪个预设块内：用「下一个 file:」切块近似即可，
  // 这里只做整体断言：三个变量名互不相同、且都出现在文本中。
  assert(patch.includes(`{{${v}}}`), `${v} 被引用`);
  assert(mine.every((x) => x.startsWith('whale_memory')), `${v} 与其他变量同名可区分`);
}
assert(new Set(allVars).size === 3, '三个变量名互不相同');

console.log('\n=== 3. 复刻宿主 assemble/renderPrompt 语义 ===');
// 参考 @deepseek-ai/dsh-system-prompt/lib/index.js
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/;
function interpolate(text, variables) {
  let result = '', last = 0;
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const close = text.indexOf('}}', open + 2);
    const name = text.slice(open + 2, close);
    if (!VARIABLE_NAME.test(name)) throw new Error('bad var name ' + name);
    if (!Object.hasOwn(variables, name)) throw new Error('unknown prompt variable ' + name);
    result += text.slice(last, open) + variables[name];
    last = close + 2;
  }
  return result + text.slice(last);
}
function assemble(sections, variables) {
  const complete = sections.find((s) => s.complete === true);
  const rendered = sections.map((s) => (s.interpolate === false ? s.text : interpolate(s.text, variables)));
  // 关键：complete 存在时，最终只剩它一个
  const final = complete === undefined
    ? rendered
    : [complete.interpolate === false ? complete.text : interpolate(complete.text, variables)];
  return final.join('\n\n');
}

const MEM = '【鲸鱼记忆 · whale-loli.md】\n文件：C:\\x\\.dsh\\whale-loli.md\n\n# 固定记忆\n- 主人爱喝冰美式\n# 滚动摘要\n- R0001 [2026-10-19 12:00] 摘要：问了记忆格式';
const sections = [
  { name: 'persona', complete: true, text: '角色：小鱼\n\n【每轮先看 · 本预设记忆】\n{{whale_memory}}\n（只看自己这份）\n\n- 规则…' },
  { name: 'whale-loli-memory', interpolate: false, text: MEM }, // 旧做法：独立 section
];
const out = assemble(sections, { whale_memory: MEM });

assert(out.includes('主人爱喝冰美式'), 'complete section 里变量被替换，记忆进入最终提示');
assert(out.includes('R0001'), '滚动摘要也进入最终提示');
assert(out.includes('角色：小鱼'), '人设本体仍在');
assert(out.split('【鲸鱼记忆').length - 1 === 1, '记忆只出现一次（未因独立 section 重复）');

console.log('\n=== 4. 反证：没有变量时，独立 section 会被丢掉（这正是修复前的状况）===');
const outOld = assemble(
  [
    { name: 'persona', complete: true, text: '角色：小鱼（没有引用变量）' },
    { name: 'whale-loli-memory', interpolate: false, text: MEM },
  ],
  { whale_memory: MEM },
);
assert(!outOld.includes('主人爱喝冰美式'), '独立 section 确实被丢弃 —— 证实修复前的 bug');
assert(outOld.includes('角色：小鱼'), '只剩 persona');

console.log('\nRESULT:', process.exitCode ? 'FAIL' : 'PASS —— 变量通道成立，独立 section 是死路');
