// 端到端隔离证明：给四个预设各挂一次 whale-memory（**变量通道**），
// 断言四条记忆各自只读到自己的文件，绝不串。
//
// 为什么是变量：persona 是 complete:true，宿主 assemble() 会把最终提示替换成
// 只剩那一个 section，独立注册的 section 永远进不去（见 src/memory.js 顶部注释）。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'whale-iso-'));
process.env.DSH_HOME = home;

const mod = await import('./src/memory.js');

// 与 patch 里四条记忆行的 config 完全一致
const CASES = [
  { file: 'whale-loli.md', variableName: 'whale_memory', body: '普通版：主人爱喝冰美式。', tag: '普通版' },
  { file: 'whale-loli-v2-live.md', variableName: 'whale_memory_v2', body: '活人版：主人怕黑。', tag: '活人版' },
  {
    file: 'whale-loli-v3-naughty.md',
    variableName: 'whale_memory_v3',
    body: '涩涩版：主人喜欢被主动黏。',
    tag: '涩涩版',
  },
  {
    file: 'dsh-whale-daughter.md',
    variableName: 'whale_memory_v4',
    body: '女儿版：爸爸答应带我去看海。',
    tag: '女儿版',
  },
];

const writeCase = (c, body) =>
  writeFileSync(
    join(home, c.file),
    `# 头\n\n# 固定记忆（不自动删除）\n\n## 关键事实（已验证）\n\n- ${body}\n\n# 滚动摘要（最多80条，FIFO）\n\n- R0001 [t] 摘要：${c.tag}的一轮\n\n# 最近详细区\n\n# 归档索引\n`,
    'utf8',
  );

for (const c of CASES) writeCase(c, c.body);

/** 模拟宿主：变量经 systemPrompt.variable() 注册，工具经 tools.register() 注册。 */
function makeCtx() {
  const vars = new Map();
  const tools = new Map();
  return {
    vars,
    tools,
    ctx: {
      systemPrompt: {
        getSectionOrder: () => 0,
        variable: (name, provider) => {
          vars.set(name, provider);
          return () => {};
        },
        section: () => {
          throw new Error('不应注册 section（complete 预设里会被宿主丢掉）');
        },
      },
      tools: {
        register: (tool) => {
          tools.set(tool.name, tool);
          return () => {};
        },
      },
      effect: (fn) => fn(),
    },
  };
}

const scopes = CASES.map(() => makeCtx());
CASES.forEach((c, i) =>
  mod.apply(scopes[i].ctx, {
    ...c,
    toolName: `${c.variableName}_add`,
    maxChars: 16000,
    turnLimit: 80,
    detailLimit: 5,
  }),
);

const names = scopes.map((s) => [...s.vars.keys()][0]);
console.log('变量名 =', names.join(' | '));

const texts = scopes.map((s, i) => [...s.vars.values()][0]());
CASES.forEach((c, i) => console.log(`\n--- ${c.tag} 注入文本 ---\n${texts[i]}`));

let ok = true;
const check = (label, cond) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) ok = false;
};

console.log('\n断言：');
check('四个变量名互不相同', new Set(names).size === CASES.length);
check('变量名都合法（[a-z][a-z0-9_]*）', names.every((n) => /^[a-z][a-z0-9_]*$/.test(n)));
check('每个 scope 只注册 1 个变量', scopes.every((s) => s.vars.size === 1));

// 写入工具：也是每 scope 一个，名字互不相同，且认自己的文件
const toolNames = scopes.map((s) => [...s.tools.keys()][0]);
console.log('写入工具 =', toolNames.join(' | '));
check('四个 scope 都注册了写入工具', scopes.every((s) => s.tools.size === 1));
check('四个写入工具名互不相同', new Set(toolNames).size === CASES.length);
check(
  '工具名 = <变量名>_add 且一一对应',
  toolNames.every((n, i) => n === `${names[i]}_add`),
);
for (let i = 0; i < CASES.length; i++) {
  const tool = scopes[i].tools.get(toolNames[i]);
  const res = await tool.execute({ summary: `${CASES[i].tag}用工具记了一笔` });
  check(
    `${CASES[i].tag} 的工具写进自己的 ${CASES[i].file}`,
    res.path.endsWith(CASES[i].file) && res.id === 'R0002',
  );
  const mine = scopes[i].vars.get(names[i])();
  check(`${CASES[i].tag} 写完自己立即看得到`, mine.includes(`${CASES[i].tag}用工具记了一笔`));
  const others = CASES.filter((_, j) => j !== i);
  check(
    `${CASES[i].tag} 写工具没串进别的文件`,
    others.every((o) => !scopes[i].vars.get(names[i])().includes(`${o.tag}用工具记了一笔`)),
  );
}

for (const [i, c] of CASES.entries()) {
  const others = CASES.filter((_, j) => j !== i);
  const leaked = others.filter((o) => texts[i].includes(o.body));
  check(
    `${c.tag} 只含自己的内容${leaked.length ? '（串了：' + leaked.map((o) => o.tag).join('、') + '）' : ''}`,
    texts[i].includes(c.body) && leaked.length === 0,
  );
  check(`${c.tag} 横幅指向 ${c.file}`, texts[i].includes(`【鲸鱼记忆 · ${c.file}】`));
  const otherFiles = others.filter((o) => texts[i].includes(o.file));
  check(
    `${c.tag} 不出现别的记忆文件名${otherFiles.length ? '（出现了：' + otherFiles.map((o) => o.file).join('、') + '）' : ''}`,
    otherFiles.length === 0,
  );
}

// 反向：改第 i 个文件，只有第 i 个变量变
const render = (i) => scopes[i].vars.get(names[i])();
for (const [i, c] of CASES.entries()) {
  const before = CASES.map((_, j) => render(j));
  const marker = `${c.tag}追加了一条新事实`;
  writeCase(c, marker);
  const after = CASES.map((_, j) => render(j));
  check(`改 ${c.file} 后自己更新`, after[i].includes(marker));
  check(
    `改 ${c.file} 后另外几个完全不变`,
    CASES.every((_, j) => j === i || after[j] === before[j]),
  );
}

// 只删一个文件，其余几个照常
rmSync(join(home, CASES[2].file));
const gone = scopes[2].vars.get(CASES[2].variableName)();
check(`删掉 ${CASES[2].file} 后仍指向自己的路径`, gone.includes(CASES[2].file));
check(
  `删掉 ${CASES[2].file} 后不泄漏别人的内容`,
  CASES.every((o, j) => j === 2 || !gone.includes(o.tag)),
);
check(
  '删掉一个文件后其余几个仍正常',
  CASES.every(
    (o, j) => j === 2 || scopes[j].vars.get(CASES[j].variableName)().includes(o.tag),
  ),
);

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', ok ? 'PASS —— 四个记忆完全隔离（变量通道）' : 'FAIL');
process.exit(ok ? 0 : 1);
