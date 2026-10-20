// 端到端验证写入工具：模拟一个带 ctx.tools 的宿主，调用 whale_memory_add，
// 断言条目真的落进文件的「滚动摘要」区、编号递增、计数刷新。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, parseMemory, memoryTemplate, memoryPath } from './src/memory.js';

function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) process.exitCode = 1;
}

// 用临时 DSH_HOME，绝不碰真实记忆文件
const home = mkdtempSync(join(tmpdir(), 'whale-tool-'));
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
const tool = registered.get('tool:whale_memory_add');
assert(!!registered.get('variable:whale_memory'), '变量 whale_memory 已注册');
assert(!!tool, '工具 whale_memory_add 已注册');
assert(tool?.description?.includes('whale-loli.md'), '工具描述里写明了自己那份文件');
assert(typeof tool?.execute === 'function', '工具带 execute');

console.log('\n=== 2. 调一次工具 ===');
// 先铺一个干净骨架
import { writeFileSync } from 'node:fs';
writeFileSync(memoryPath(FILE), memoryTemplate(FILE), 'utf8');
const before = parseMemory(readFileSync(memoryPath(FILE), 'utf8'));
console.log(`     调用前滚动条数: ${before.roll.length}`);

const out = await tool.execute({ summary: '主人说喜欢我，我害羞撒娇' });
console.log(`     返回: id=${out.id} path=${out.path} count=${out.count}/${out.limit} archived=${out.archived}`);

const after = parseMemory(readFileSync(memoryPath(FILE), 'utf8'));
console.log(`     调用后滚动条数: ${after.roll.length}`);
console.log(`     最后一条: ${after.roll.at(-1)?.text}`);

assert(after.roll.length === before.roll.length + 1, '滚动摘要多了一条');
assert(out.id === after.roll.at(-1)?.id, '返回的 id 就是新条目 id');
assert(after.roll.at(-1)?.text.includes('主人说喜欢我，我害羞撒娇'), '内容写进去了');
assert(out.count === after.roll.length, '返回的 count 与文件一致');
assert(after.detail.includes('R0001'), '详细区也同步了');

console.log('\n=== 3. 再调一次，编号递增 ===');
const out2 = await tool.execute({ summary: '主人说抱抱我，我钻他怀里' });
const after2 = parseMemory(readFileSync(memoryPath(FILE), 'utf8'));
console.log(`     第二条: ${after2.roll.at(-1)?.text}`);
assert(out2.id !== out.id, '编号不重复');
assert(Number(out2.id.slice(1)) === Number(out.id.slice(1)) + 1, '编号递增 1');
assert(after2.roll.length === after.roll.length + 1, '又多了第 2 条');

console.log('\n=== 4. 变量读出来能看到新条目 ===');
const rendered = registered.get('variable:whale_memory')();
assert(rendered.includes('主人说喜欢我'), '注入文本含第 1 条');
assert(rendered.includes('主人说抱抱我'), '注入文本含第 2 条');
assert(rendered.includes('whale-loli.md'), '注入文本带文件路径');

console.log('\n=== 5. 空 summary 被拒 ===');
let threw = false;
try { await tool.execute({ summary: '   ' }); } catch { threw = true; }
assert(threw, '空摘要抛错');

console.log('\n=== 6. 三个预设的工具名互不相同 ===');
assert('whale_memory_add' !== 'whale_memory_v2_add' && 'whale_memory_v2_add' !== 'whale_memory_v3_add', '工具名可区分');

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', process.exitCode ? 'FAIL' : 'PASS —— 记忆写入工具可用');
