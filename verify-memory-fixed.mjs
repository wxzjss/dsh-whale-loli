// 端到端验证「固定记忆」写入工具：whale_memory_<预设>_fixed。
// 断言：默认 append 不覆盖旧内容；显式 replace 才整节替换；其它小节、滚动摘要、
// 归档索引毫发无伤；小节名容错；未知小节与空内容抛错；写最后一节不会把后面的一级标题吞进来。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, memoryPath, memoryTemplate, parseMemory } from './src/memory.js';

function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) process.exitCode = 1;
}

// 用临时 DSH_HOME，绝不碰真实记忆文件
const home = mkdtempSync(join(tmpdir(), 'whale-fixed-'));
process.env.DSH_HOME = home;

const registered = new Map();
const ctx = {
  effect(fn) {
    const d = fn();
    return () => typeof d === 'function' && d();
  },
  systemPrompt: {
    variable(name, provider) {
      registered.set('variable:' + name, provider);
      return () => registered.delete('variable:' + name);
    },
  },
  tools: {
    register(tool) {
      registered.set('tool:' + tool.name, tool);
      return () => registered.delete('tool:' + tool.name);
    },
  },
  on() {
    return () => {};
  },
};

const FILE = 'whale-loli.md';
apply(ctx, { file: FILE, variableName: 'whale_memory', toolName: 'whale_memory_add', turnLimit: 80, detailLimit: 5 });

console.log('=== 1. 注册了什么 ===');
const tool = registered.get('tool:whale_memory_fixed');
const addTool = registered.get('tool:whale_memory_add');
assert(!!tool, '工具 whale_memory_fixed 已注册');
assert(!!addTool, '原来的 whale_memory_add 还在');
assert(tool?.parameters?.required?.includes('section'), 'section 是必填参数');
assert(tool?.parameters?.required?.includes('content'), 'content 是必填参数');
assert(
  JSON.stringify(tool?.parameters?.properties?.mode?.enum) === JSON.stringify(['append', 'replace']),
  'mode 只有 append / replace 两个值',
);
assert(tool?.description?.includes('whale-loli.md'), '工具描述里写明了自己那份文件');

const SECTIONS = [
  '任务目标',
  '用户约束/偏好',
  '当前状态',
  '待办',
  '关键决策',
  '关键事实（已验证）',
  '文件/路径/命令',
  '错误与修复',
];

console.log('\n=== 2. 铺满 8 个小节 ===');
writeFileSync(memoryPath(FILE), memoryTemplate(FILE), 'utf8');
for (const [i, s] of SECTIONS.entries()) {
  await tool.execute({ section: s, content: `- 第${i + 1}节原始内容`, mode: 'replace' });
}
await addTool.execute({ summary: '对照用的滚动摘要' });

const base = parseMemory(readFileSync(memoryPath(FILE), 'utf8'));
for (const s of SECTIONS) assert(base.fixed.includes(`## ${s}`), `小节 ${s} 有内容`);
assert(base.roll.length === 1, '铺一条滚动摘要对照');

console.log('\n=== 3. 默认 append（不传 mode）===');
const r1 = await tool.execute({ section: '待办', content: '- 新加的一条' });
const p1 = parseMemory(readFileSync(memoryPath(FILE), 'utf8'));
console.log(`     返回 mode=${r1.mode} section=${r1.section}`);
assert(r1.mode === 'append', '不传 mode 时默认是 append');
assert(p1.fixed.includes('第4节原始内容'), 'append 保留了原有内容');
assert(p1.fixed.includes('新加的一条'), 'append 把新内容写进去了');

console.log('\n=== 4. 显式 replace 才覆盖 ===');
const r2 = await tool.execute({ section: '待办', content: '- 只剩这一条', mode: 'replace' });
const p2 = parseMemory(readFileSync(memoryPath(FILE), 'utf8'));
assert(r2.mode === 'replace', '显式 replace 生效');
assert(!p2.fixed.includes('第4节原始内容'), 'replace 把旧内容覆盖掉了');
assert(p2.fixed.includes('只剩这一条'), 'replace 写入了新内容');

console.log('\n=== 5. 其它小节没被牵连 ===');
for (const s of SECTIONS.filter((x) => x !== '待办')) {
  assert(p2.fixed.includes(`## ${s}`) && p2.fixed.includes(`第${SECTIONS.indexOf(s) + 1}节原始内容`), `${s} 内容完好`);
}

console.log('\n=== 6. 滚动摘要与归档索引没被吞 ===');
const raw6 = readFileSync(memoryPath(FILE), 'utf8');
assert(p2.roll.length === 1, '滚动摘要条数不变');
assert(p2.roll[0].text.includes('对照用的滚动摘要'), '滚动摘要内容不变');
assert(raw6.includes('# 滚动摘要'), '滚动摘要区标题还在');
assert(raw6.includes('# 最近详细区'), '最近详细区标题还在');
assert(raw6.includes('# 归档索引'), '归档索引标题还在');

console.log('\n=== 7. 小节名容错 ===');
const r3 = await tool.execute({ section: '## 关键决策', content: '- 带井号也能认' });
assert(r3.section === '## 关键决策', '带 ## 前缀的小节名能识别');
const r4 = await tool.execute({ section: '  待办  ', content: '- 两侧空格也无所谓' });
assert(r4.section === '## 待办', '两侧空格会被 trim');

console.log('\n=== 8. 未知小节 / 空内容 抛错 ===');
let err = null;
try {
  await tool.execute({ section: '瞎写的节', content: 'x' });
} catch (e) {
  err = e;
}
assert(!!err && /未知固定记忆小节/.test(err.message), '未知小节抛错，且错误里列了可用小节');
err = null;
try {
  await tool.execute({ section: '待办', content: '   ' });
} catch (e) {
  err = e;
}
assert(!!err && /content 不能为空/.test(err.message), '空内容抛错');

console.log('\n=== 9. 写最后一节不会吃掉后面的一级标题 ===');
await tool.execute({ section: '错误与修复', content: '- 最后一节也能写', mode: 'replace' });
const raw9 = readFileSync(memoryPath(FILE), 'utf8');
assert(raw9.includes('# 滚动摘要'), '写最后一节后滚动摘要标题仍在');
assert(/# 滚动摘要[\s\S]*?R0001/.test(raw9), '滚动摘要条目没有被吞进固定区');
assert(/# 归档索引[\s\S]*$/.test(raw9), '归档索引仍收尾');

console.log('\n=== 10. 记忆文件还能被正常解析（round-trip）===');
const final = parseMemory(raw9);
assert(final.roll.length === 1, '滚动摘要那一条还在');
assert(final.fixed.includes('最后一节也能写'), '最后一节写成功');

rmSync(home, { recursive: true, force: true });
console.log(process.exitCode ? '\nRESULT: FAIL' : '\nRESULT: PASS —— 固定记忆写入工具可用');
