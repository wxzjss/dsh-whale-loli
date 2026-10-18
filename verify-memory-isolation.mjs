// 端到端隔离证明：给三个预设各挂一次 whale-memory，写入不同的记忆内容，
// 断言三条 section 各自只读到自己的文件，绝不串。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'whale-iso-'));
process.env.DSH_HOME = home;

const mod = await import('./src/memory.js');

// 与 patch 里三条记忆行的 config 完全一致
const CASES = [
  { file: 'whale-loli.md', sectionName: 'whale-loli-memory', body: '普通版：主人爱喝冰美式。', tag: '普通版' },
  { file: 'whale-loli-v2-live.md', sectionName: 'whale-loli-v2-live-memory', body: '活人版：主人怕黑。', tag: '活人版' },
  {
    file: 'whale-loli-v3-naughty.md',
    sectionName: 'whale-loli-v3-naughty-memory',
    body: '涩涩版：主人喜欢被主动黏。',
    tag: '涩涩版',
  },
];

// 准备三个不同的记忆文件（新格式：重要记忆 + 对话记录）
for (const c of CASES) {
  writeFileSync(
    join(home, c.file),
    `# 头\n\n> 引用\n\n## 重要记忆\n\n- ${c.body}\n\n## 对话记录\n\n- 2026-10-18 ${c.tag}的一轮对话\n`,
    'utf8',
  );
}

// 模拟宿主：给每个预设建一个独立 scope 上下文，记录它注册的 section
function makeCtx() {
  const sections = [];
  return {
    sections,
    ctx: {
      systemPrompt: {
        getSectionOrder: () => 0,
        section: (s) => {
          sections.push(s);
          return () => {};
        },
      },
      effect: (fn) => fn(),
    },
  };
}

const scopes = CASES.map(() => makeCtx());
CASES.forEach((c, i) => mod.apply(scopes[i].ctx, { ...c, maxChars: 16000, turnLimit: 80 }));

const sections = scopes.map((s) => s.sections[0]);

console.log('section 名 =', sections.map((s) => s.name).join(' | '));

const texts = sections.map((s) => s.text());
CASES.forEach((c, i) => console.log(`\n--- ${c.tag} 注入文本 ---\n${texts[i]}`));

let ok = true;
const check = (label, cond) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) ok = false;
};

console.log('\n断言：');

// 1) 三个 section 名互不相同
const names = sections.map((s) => s.name);
check('三个 section 名互不相同', new Set(names).size === 3);

// 2) 每条 section 只含自己的内容，不含另外两个
for (const [i, c] of CASES.entries()) {
  const others = CASES.filter((_, j) => j !== i);
  const leaked = others.filter((o) => texts[i].includes(o.body));
  check(
    `${c.tag} 只含自己的内容${leaked.length ? '（串了：' + leaked.map((o) => o.tag).join('、') + '）' : ''}`,
    texts[i].includes(c.body) && leaked.length === 0,
  );
  check(`${c.tag} 标题指向 ${c.file}`, texts[i].includes(`【鲸鱼记忆 · ${c.file}】`));
  const otherFiles = others.filter((o) => texts[i].includes(o.file));
  check(
    `${c.tag} 不出现别的记忆文件名${otherFiles.length ? '（出现了：' + otherFiles.map((o) => o.file).join('、') + '）' : ''}`,
    otherFiles.length === 0,
  );
}
check('模板骨架已被剥掉', texts.every((t) => !t.includes('# 头') && !t.includes('> 引用')));

// 3) 反向验证：改第 i 个文件，只有第 i 条 section 变，其余完全不变
for (const [i, c] of CASES.entries()) {
  const before = texts.slice();
  const marker = `${c.tag}追加了一条新记忆`;
  writeFileSync(join(home, c.file), `# 头\n\n## 重要记忆\n\n- ${marker}\n`, 'utf8');
  const after = sections.map((s) => s.text());
  check(`改 ${c.file} 后自己更新`, after[i].includes(marker));
  check(
    `改 ${c.file} 后另外两个完全不变`,
    CASES.every((_, j) => j === i || after[j] === before[j]),
  );
  texts[i] = after[i];
}

// 4) 只删一个文件，另外两个照常
rmSync(join(home, CASES[2].file));
check(`删掉 ${CASES[2].file} 后该 section 为空`, sections[2].text() === '');
check(
  '删掉一个文件后另外两个仍正常',
  sections[0].text().includes(CASES[0].tag) && sections[1].text().includes(CASES[1].tag),
);

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', ok ? 'PASS —— 三个记忆文件完全隔离' : 'FAIL');
process.exit(ok ? 0 : 1);
