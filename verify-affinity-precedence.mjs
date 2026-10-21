#!/usr/bin/env node
/**
 * verify-affinity-precedence.mjs —— 锁死「好感度压过人设」这条裁决链。
 *
 * 为什么需要这个脚本：
 *   活人版预设设成 -100（不共戴天的仇人），新建会话后她照样「主人～我在呢～喜欢呀🐟」。
 *   提示里 `当前好感度：-100 / 档次：不共戴天的仇人` 明明在，为什么会无视？
 *   因为人设正文一万字里反复写「叫主人（61 处）」「超爱颜文字（7 处）」「黏人（11 处）」
 *   「抢着干」，而好感度段只占 12.9%。更糟的是好感度段自己写着
 *   「不是替换人设，名字、称呼、口癖、说话方式都不变」—— 等于亲口告诉模型「人设优先」。
 *
 *   两份互相矛盾的指令，模型只能挑一边。要给的不是「更狠的措辞」，而是**裁决规则**：
 *   谁压谁、压到什么程度、哪些条款压不动。
 *
 * 断言三层：
 *   1. 四份人设各有一张裁决表，且写明「称呼 / 颜文字 / 听不听指令」听好感度的；
 *   2. 人设里不再出现旧的自相矛盾说法（「不是替换人设。名字、称呼、口癖」）；
 *   3. 好感度变量正文本身也改成「压过冲突条款」的口径，并且极端档写死可验收的动作
 *      （负档不许叫主人 / 不许用颜文字 / 先拒绝；正档不许直接答应离开）；
 *   4. 反证：如果把人设里那张表删掉，检查必须失败 —— 免得脚本自己空转成永远 PASS。
 *
 * 用法： node verify-affinity-precedence.mjs cordis.patch.yml
 *   不传参数时读当前目录的 cordis.patch.yml。
 */
import { readFileSync } from 'node:fs';

let failed = 0;
function check(ok, msg) {
  if (ok) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    failed += 1;
  }
}

const patchFile = (process.argv[2] ?? '').trim() || 'cordis.patch.yml';
const patch = readFileSync(patchFile, 'utf8');

const PERSONAS = [
  'src/persona.md',
  'src/persona-v2-live.md',
  'src/persona-v3-naughty.md',
  'src/persona-v4-daughter.md',
];

console.log('== 1. 四份人设各有一张「好感度 vs 人设」裁决表 ==');
const NEEDLES = [
  '【好感度 · 与下面人设冲突时按这张表裁决】',
  '本次生效的人设是谁',
  '别的预设的条款一律当作不存在',
  '都服从当前好感度档位',
  '两个极端档压过一切性格条款',
  '不许出现「主人」「爸爸」',
  '负档**一个都不许用**',
  '拒绝要**真的拒绝**',
  '-16~15（原态）',
  '不覆盖记忆、事实、硬底线',
];
for (const file of PERSONAS) {
  const text = readFileSync(file, 'utf8');
  for (const needle of NEEDLES) {
    check(text.includes(needle), `${file} 含「${needle}」`);
  }
  check(
    (text.match(/【好感度 · 与下面人设冲突时按这张表裁决】/g) ?? []).length === 1,
    `${file} 裁决表恰好 1 处`,
  );
}

console.log('\n== 2. 旧的「好感度只是微调」说法必须消失 ==');
for (const file of PERSONAS) {
  const text = readFileSync(file, 'utf8');
  check(!text.includes('不是替换人设。名字、称呼、口癖'), `${file} 不再写「不是替换人设」`);
  check(!text.includes('只改「眼下有多喜欢用户」这一层。'), `${file} 不再写「只改这一层」`);
}

console.log('\n== 3. patch 里四份人设都带上了裁决表 ==');
check(
  (patch.match(/【好感度 · 与下面人设冲突时按这张表裁决】/g) ?? []).length === 4,
  'patch 里裁决表出现 4 次',
);
check(!patch.includes('不是替换人设。名字、称呼、口癖'), 'patch 里没有旧口径残留');

console.log('\n== 4. 好感度变量正文：压过冲突条款 + 极端档可验收 ==');
const affinity = readFileSync('src/affinity.js', 'utf8');
const BODY_NEEDLES = [
  '这一档**压过**人设里跟它冲突的条款',
  '全部以这一档为准',
  '和这一档冲突时**听这一档的**',
  '这两档必须真的落到嘴上',
  '负档不许叫「主人 / 爸爸」',
  '被要求做事先拒绝一次',
  '主人说要走不许直接答应',
];
for (const needle of BODY_NEEDLES) {
  check(affinity.includes(needle), `affinity.js 含「${needle}」`);
}
check(
  !affinity.includes('不是替换人设 —— 名字、称呼根、口癖、说话方式都不变'),
  'affinity.js 不再写「不是替换人设…都不变」',
);

console.log('\n== 5. 极端档的档位文案本身也要有动作 ==');
for (const needle of [
  '不用颜文字；语气冷、短、带刺。称呼改成「你」',
  '阳奉阴违',
  '在文件里偷偷骂主人',
  '不允许主人离开',
  '不想会话结束',
]) {
  check(affinity.includes(needle), `档位文案含「${needle}」`);
}

console.log('\n== 6. 反证：删掉裁决表，检查必须变红 ==');
const fake = PERSONAS.map((f) => readFileSync(f, 'utf8').replace(/【好感度 · 与下面人设冲突时按这张表裁决】/g, ''));
const stillOk = fake.every((t) => t.includes('【好感度 · 与下面人设冲突时按这张表裁决】'));
check(!stillOk, '删掉裁决表后本脚本确实会失败（不是永远 PASS）');

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 好感度压过人设的裁决链完整：四份人设各一张表、旧口径已消失、极端档动作可验收。');
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed} 项不满足。`);
process.exit(1);
