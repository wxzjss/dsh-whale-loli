// 真实装配演练：从 cordis.patch.yml 取出每个预设的 persona 原文，
// 用宿主 renderPrompt 的 interpolate 语义 + 真实 composeMemory 输出，
// 逐个复刻最终系统提示，检查记忆是否真的在里面、有没有串到别人身上。
import { readFileSync } from 'node:fs';
import { composeMemory } from './src/memory.js';

const patch = readFileSync('cordis.patch.yml', 'utf8');

let bad = 0;
const check = (label, ok) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label);
  if (!ok) bad++;
};

/** 从 patch 里取出包含 marker 的那个块标量正文。 */
function personaBlock(marker) {
  const at = patch.indexOf(marker);
  if (at < 0) throw new Error('找不到 ' + marker);
  // 向前找块标量的起点（persona 用的是 `prefix: |-`，不是 text:），取离 marker 最近的那个
  const head = patch.slice(0, at);
  const anchor = /(?:prefix|text|suffix):[ \t]*[|>][-+]?[ \t]*\r?\n/g;
  let m = null;
  let scan = anchor.exec(head);
  while (scan) { m = scan; scan = anchor.exec(head); }
  if (!m) throw new Error('找不到块标量起点（' + marker + '）');
  const lineStart = patch.lastIndexOf('\n', m.index) + 1;
  const indentMatch = /^(\s*)/.exec(patch.slice(lineStart));
  const indent = indentMatch[1];

  const lines = patch.slice(lineStart).split('\n');
  const body = [];
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim() === '') { body.push(''); continue; }
    const ind = /^(\s*)/.exec(ln)[1].length;
    if (ind <= indent.length) break;
    body.push(ln);
  }
  const bodyIndent = Math.min(...body.filter((l) => l.trim()).map((l) => /^(\s*)/.exec(l)[1].length));
  return body.map((l) => l.slice(bodyIndent)).join('\n');
}

/** 复刻宿主 interpolate（@deepseek-ai/dsh-system-prompt）。 */
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

const PRESETS = [
  {
    tag: '普通版',
    file: 'whale-loli.md',
    variable: 'whale_memory',
    marker: '{{whale_memory}}',
    affinity: 'affinity_v1',
    home: 'C:\\Users\\35453\\.dsh\\whale-loli.md',
  },
  {
    tag: '活人版',
    file: 'whale-loli-v2-live.md',
    variable: 'whale_memory_v2',
    marker: '{{whale_memory_v2}}',
    affinity: 'affinity_v2',
    home: 'C:\\Users\\35453\\.dsh\\whale-loli-v2-live.md',
  },
  {
    tag: '涩涩版',
    file: 'whale-loli-v3-naughty.md',
    variable: 'whale_memory_v3',
    marker: '{{whale_memory_v3}}',
    affinity: 'affinity_v3',
    home: 'C:\\Users\\35453\\.dsh\\whale-loli-v3-naughty.md',
  },
  {
    tag: '女儿版',
    file: 'dsh-whale-daughter.md',
    variable: 'whale_memory_v4',
    marker: '{{whale_memory_v4}}',
    affinity: 'affinity_v4',
    home: 'C:\\Users\\35453\\.dsh\\dsh-whale-daughter.md',
  },
];

// 所有变量名：用来给「别人不该被用到」做哨兵
const SENTINELS = new Map(PRESETS.map((p) => [p.variable, `（${p.variable} 不该被用到）`]));

for (const p of PRESETS) {
  console.log(`\n===== ${p.tag}（${p.file}）=====`);

  const personaText = personaBlock(p.marker);
  console.log('  persona 长度:', personaText.length, '字符');
  check('persona 含自己的变量', personaText.includes(p.marker));

  // 真实 composeMemory
  const mem = composeMemory(p.file, { maxChars: 16000, turnLimit: 80, detailLimit: 5 });
  check(`composeMemory('${p.file}') 有返回`, mem !== null && mem !== undefined);
  const body = mem ? mem.text : '';
  const variableValue = `【鲸鱼记忆 · ${p.file}】\n文件：${p.home}\n\n${body}`;
  console.log('  记忆正文:', body.length, '字符 | 滚动', mem?.keptRoll, '/', mem?.totalRoll);

  // 只注册自己的变量 —— 别的变量缺失会抛，正好证明人设没乱引用。
  // 好感度变量与记忆变量成对出现：自己的在、别人的不在。
  let final;
  try {
    final = interpolate(personaText, {
      [p.variable]: variableValue,
      [p.affinity]: '当前好感度：0（原态）',
    });
  } catch (e) {
    check('插值只用到自己的变量（' + e.message + '）', false);
    continue;
  }
  check('插值只用到自己的变量', true);
  console.log('  最终系统提示:', final.length, '字符');

  check('人设本体还在', final.includes('小鱼'));
  check('好感度块已注入', final.includes('【好感度】') && final.includes('当前好感度：0'));
  check('记忆横幅指向自己的文件', final.includes(`【鲸鱼记忆 · ${p.file}】`));
  check('记忆文件路径正确', final.includes(p.home));
  check('有内容时四区齐', body === '' || ['# 固定记忆', '# 滚动摘要', '# 最近详细区', '# 归档索引'].every((z) => final.includes(z)));
  check('没有残留 {{', !final.includes('{{'));
  for (const [v, sentinel] of SENTINELS) {
    if (v === p.variable) continue;
    check(`没串到 ${v}`, !final.includes(sentinel));
  }

  console.log(`  开头 300 字：\n${final.slice(0, 300).split('\n').map((l) => '    ' + l).join('\n')}`);
}

console.log('\nRESULT:', bad ? `FAIL (${bad} 项)` : 'PASS —— 四个预设的记忆都各自进入最终系统提示，互不串台');
process.exitCode = bad ? 1 : 0;
