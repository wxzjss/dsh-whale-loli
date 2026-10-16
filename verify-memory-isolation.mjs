// 端到端隔离证明：给两个预设各挂一次 whale-memory，写入不同的记忆内容，
// 断言两条 section 各自只读到自己的文件，绝不串。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'whale-iso-'));
process.env.DSH_HOME = home;

const mod = await import('./src/memory.js');

// 准备两个不同的记忆文件
writeFileSync(join(home, 'whale-loli.md'), '# 头\n\n> 引用\n\n普通版：主人爱喝冰美式。\n', 'utf8');
writeFileSync(join(home, 'whale-loli-v2-live.md'), '# 头\n\n> 引用\n\n活人版：主人怕黑。\n', 'utf8');

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

const a = makeCtx();
const b = makeCtx();

// 与 patch 里两条记忆行的 config 完全一致
mod.apply(a.ctx, { file: 'whale-loli.md', sectionName: 'whale-loli-memory', maxChars: 6000 });
mod.apply(b.ctx, { file: 'whale-loli-v2-live.md', sectionName: 'whale-loli-v2-live-memory', maxChars: 6000 });

const sa = a.sections[0];
const sb = b.sections[0];

console.log('section A name =', sa.name);
console.log('section B name =', sb.name);

const ta = sa.text();
const tb = sb.text();
console.log('\n--- A 注入文本 ---\n' + ta);
console.log('\n--- B 注入文本 ---\n' + tb);

let ok = true;
const check = (label, cond) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) ok = false;
};

console.log('\n断言：');
check('两个 section 名不同', sa.name !== sb.name);
check('A 只含普通版内容', ta.includes('主人爱喝冰美式') && !ta.includes('主人怕黑'));
check('B 只含活人版内容', tb.includes('主人怕黑') && !tb.includes('主人爱喝冰美式'));
check('A 标题指向 whale-loli.md', ta.includes('【鲸鱼记忆 · whale-loli.md】'));
check('B 标题指向 whale-loli-v2-live.md', tb.includes('【鲸鱼记忆 · whale-loli-v2-live.md】'));
check('A 不出现 v2 文件名', !ta.includes('whale-loli-v2-live.md'));
check('B 不出现 v1 文件名', !tb.includes('whale-loli.md'));
check('模板骨架已被剥掉', !ta.includes('# 头') && !ta.includes('> 引用'));

// 反向验证：A 写完不影响 B
writeFileSync(join(home, 'whale-loli.md'), '# 头\n\n普通版追加了一条新记忆。\n', 'utf8');
const ta2 = sa.text();
const tb2 = sb.text();
check('A 改动后 A 更新', ta2.includes('追加了一条新记忆'));
check('A 改动后 B 完全不变', tb2 === tb);

// 反向：B 写完不影响 A
writeFileSync(join(home, 'whale-loli-v2-live.md'), '# 头\n\n活人版也追加了一条。\n', 'utf8');
const ta3 = sa.text();
const tb3 = sb.text();
check('B 改动后 B 更新', tb3.includes('活人版也追加了一条'));
check('B 改动后 A 完全不变', ta3 === ta2);

// 只有一个文件存在时，另一个不误读
rmSync(join(home, 'whale-loli-v2-live.md'));
check('删掉 B 文件后 B 为空', sb.text() === '');
check('删掉 B 文件后 A 正常', sa.text().includes('追加了一条新记忆'));

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', ok ? 'PASS —— 两个记忆文件完全隔离' : 'FAIL');
process.exit(ok ? 0 : 1);
