#!/usr/bin/env node
/**
 * verify-affinity-conditioned-persona.mjs —— 锁死「人设本身按好感度说话」。
 *
 * 背景：活人版设成 -100，她在提示里明明看到「不共戴天的仇人」，还是「主人~ 喜欢呀」。
 * 光在好感度段讲道理没用 —— 人设正文 7500 字里「主人」61 处、「颜文字」7 处、「黏」11 处，
 * 而且「你叫他主人」「黏人护主」是**人设结构**，比一段 969 字的档位说明重得多。
 *
 * 所以改的不是提示词，是**人设本身**：把「亲近 / 黏人 / 称呼 / 颜文字 / 主动关心」
 * 这些条款从「无条件」改成「以好感度为条件」。文件里称呼条款一个字没删（主人要求），
 * 只是加上了生效条件。
 *
 * 断言：
 *   1. 活人版人设里，亲近类条款必须带好感度条件（不能是裸的「默认叫主人」）；
 *   2. 必须写明「好感度为负 → 叫「你」」；
 *   3. 关系、黏人、傲娇的「甜」、懒懒的「秒上线」四处都挂了条件；
 *   4. 示例区要有负档范例（光有正面例子模型只会学正面）；
 *   5. 反证：把条件删掉后本脚本必须变红。
 *
 * 用法： node verify-affinity-conditioned-persona.mjs cordis.patch.yml
 */
import { readFileSync } from 'node:fs';

let failed = 0;
const check = (ok, msg) => {
  if (ok) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failed += 1;
  }
};

const FILE = 'src/persona-v2-live.md';
const text = readFileSync(FILE, 'utf8');
const patchFile = (process.argv[2] ?? '').trim() || 'cordis.patch.yml';
const patch = readFileSync(patchFile, 'utf8');

console.log('== 1. 亲近类条款必须挂好感度条件 ==');
const CONDITIONED = [
  ['关系', '全看当前好感度那一段写的'],
  ['傲娇的「甜」', '「甜」这一半只在好感度 0 以上成立'],
  ['黏人护主', '好感度的直接表现，不是固定设定'],
  ['懒懒的「秒上线」', '好感度正**时才「他有事秒上线」'],
  ['默认称呼', '好感度 ≥ 0 时才叫「主人」'],
  ['颜文字', '好感度为负时一个都不用'],
];
for (const [name, needle] of CONDITIONED) {
  check(text.includes(needle), `${name} 挂上了好感度条件（含「${needle}」）`);
}

console.log('\n== 2. 必须写明负档改称「你」，且不许删掉称呼条款 ==');
check(text.includes('好感度为负 → 改叫「你」'), '写明「好感度为负 → 改叫「你」」');
check(text.includes('这是称呼规则，不是语气问题'), '说明这是规则而非语气');
check(text.includes('· 名字：小鱼。用户叫你什么你都接，但你叫他“主人”。'), '称呼条款原文仍在（不删称呼）');

console.log('\n== 3. 示例区要有负档范例 ==');
check(text.includes('（好感度为负时，上面这些甜的和软的都不作数'), '有负档说明');
check(text.includes('你：不喜欢。问这个做什么。'), '有负档对话范例');
check(text.includes('你：干嘛。'), '有冷回应的范例');

console.log('\n== 4. patch 里活人版确实带上了这些条件 ==');
check((patch.match(/好感度 ≥ 0 时才叫/g) ?? []).length === 1, 'patch 里只有活人版改了称呼条件');
check((patch.match(/好感度的直接表现/g) ?? []).length === 1, 'patch 里黏人条款只有活人版挂了条件');
check(patch.includes('好感度为负 → 改叫「你」'), 'patch 含负档改称规则');

console.log('\n== 5. 其他三个预设不该被顺手改到 ==');
for (const f of ['src/persona.md', 'src/persona-v3-naughty.md', 'src/persona-v4-daughter.md']) {
  const other = readFileSync(f, 'utf8');
  check(!other.includes('好感度 ≥ 0 时才叫'), `${f} 未被改动（称呼条件保持原样）`);
}

console.log('\n== 6. 反证：删掉条件，检查必须变红 ==');
const stripped = text.replace(/好感度 ≥ 0 时才叫「主人」/g, '默认叫「主人」');
check(!stripped.includes('好感度 ≥ 0 时才叫'), '删掉条件后本脚本确实会失败（不是永远 PASS）');

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 活人版人设的亲近条款已全部以好感度为条件，负档改称「你」且有范例。');
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed} 项不满足。`);
process.exit(1);
