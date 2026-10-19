// 用假 ctx 冒烟测试 memory.js：apply() 现在注册的是**提示变量**（不是 section）。
// 因为 persona 是 complete:true，宿主会把独立 section 丢掉 —— 变量才是有效通道。
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'whale-mem-'));
process.env.DSH_HOME = dir;

const mod = await import('./src/memory.js');

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};
const P = join(dir, 'whale-loli.md');

const vars = new Map();
const sections = [];
const ctx = {
  systemPrompt: {
    getSectionOrder: (n) => (n === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : undefined),
    variable: (name, provider) => {
      vars.set(name, provider);
      return () => {};
    },
    section: (s) => {
      sections.push(s);
      return () => {};
    },
  },
  effect: (fn, label) => {
    console.log('effect label:', label);
    return fn();
  },
};

mod.apply(ctx, {});

console.log('\n=== 注册形态 ===');
check('注册了 1 个变量', vars.size === 1, `实际 ${vars.size}`);
check('变量名 = whale_memory', vars.has('whale_memory'));
check('没有注册 section（complete 预设里必被丢弃）', sections.length === 0);
check('provider 是函数（每次组装重读盘）', typeof vars.get('whale_memory') === 'function');

const read = () => vars.get('whale_memory')();

console.log('\n=== 读盘行为 ===');
// 文件不存在时不再返回空串：必须给出绝对路径，否则新预设开局不知道往哪写
const missing = read();
check('文件不存在 → 仍给出横幅与路径', missing.includes('【鲸鱼记忆 · whale-loli.md】') && missing.includes('文件：'));
check('文件不存在 → 明说是空的', missing.includes('空'));

writeFileSync(P, `# 头\n\n# 固定记忆（不自动删除）\n\n## 关键事实（已验证）\n\n- 主人喜欢夜宵\n\n# 滚动摘要（最多80条，FIFO）\n\n- R0001 [t] 摘要：聊到夜宵\n\n# 最近详细区\n\n# 归档索引\n`, 'utf8');
const out = read();
check('含横幅', out.includes('【鲸鱼记忆 · whale-loli.md】'));
check('含文件路径', out.includes('文件：'));
check('含固定记忆内容', out.includes('主人喜欢夜宵'));
check('含滚动摘要', out.includes('R0001'));
check('含四个区标题', ['# 固定记忆', '# 滚动摘要', '# 最近详细区', '# 归档索引'].every((k) => out.includes(k)));

console.log('\n=== 改文件立即生效（不用重载宿主）===');
writeFileSync(P, `# 头\n\n# 固定记忆（不自动删除）\n\n## 待办\n\n- 新加的一条待办\n`, 'utf8');
check('重新读即见新内容', read().includes('新加的一条待办'));

console.log('\n=== 只有骨架 → 只给路径提示，不塞假内容 ===');
writeFileSync(P, mod.memoryTemplate('whale-loli.md'), 'utf8');
const skeleton = read();
check('骨架仍给路径', skeleton.includes('文件：'));
check('骨架不塞假内容', !skeleton.includes('主人喜欢夜宵'));
check('骨架不含空小节标题', !skeleton.includes('## 任务目标\n\n\n'));

console.log('\n=== emitSection:true 才额外注册 section ===');
const vars2 = new Map();
const sections2 = [];
mod.apply(
  {
    systemPrompt: {
      getSectionOrder: () => 0,
      variable: (n, p) => (vars2.set(n, p), () => {}),
      section: (s) => (sections2.push(s), () => {}),
    },
    effect: (fn) => fn(),
  },
  { emitSection: true, sectionName: 'custom-mem' },
);
check('变量仍注册', vars2.size === 1);
check('section 也被注册', sections2.length === 1 && sections2[0].name === 'custom-mem');
check('section 的 order < 0', sections2[0].order < 0);
check('section interpolate=false', sections2[0].interpolate === false);

console.log('\n=== disabled ===');
const vars3 = new Map();
mod.apply({ systemPrompt: { variable: (n, p) => (vars3.set(n, p), () => {}), getSectionOrder: () => 0 }, effect: (f) => f() }, { disabled: true });
check('disabled 时什么都不注册', vars3.size === 0);

rmSync(dir, { recursive: true, force: true });
console.log('\n' + (ok ? 'SMOKE OK' : 'SMOKE FAIL'));
process.exit(ok ? 0 : 1);
