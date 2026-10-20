#!/usr/bin/env node
/**
 * 用**宿主自己的** JSON-Schema 校验器检查四个写入工具的 schema。
 *
 * 为什么需要这个脚本：
 *   曾经把 `{ type: 'string', required: true }` 写在单个属性上（想表达"这个字段
 *   必有"），宿主报的是
 *     agent-preset/invalid: whale-memory (dsh-whale-loli): unsupported JSON schema:
 *     schema.properties.id.required is not supported on type "string"; ...
 *   症状不是"这条工具坏了"，而是**四个预设全部加载失败、一个都建不了会话**。
 *   手写仿制的校验再像也只是仿制，所以这里直接 import
 *   `@deepseek-ai/dsh-tools` 的 `assertSupportedJsonSchema` / `assertObjectJsonSchema`。
 *
 * 没有 DSH 安装时（例如 CI）优雅跳过。
 */
import { requireDshTools } from './lib/dsh-root.mjs';

const DSH = requireDshTools('工具 schema 校验');
const tools = await import(
  new URL(`file:///${DSH.replace(/\\/g, '/')}/node_modules/@deepseek-ai/dsh-tools/lib/index.js`).href
);
const { assertSupportedJsonSchema, assertObjectJsonSchema } = tools;

function assert(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) process.exitCode = 1;
}

/** 抓一条真实注册的工具（不碰真实记忆文件，用临时 DSH_HOME）。 */
const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const home = mkdtempSync(join(tmpdir(), 'whale-schema-'));
process.env.DSH_HOME = home;

const { apply } = await import('./src/memory.js');

const TOOLS = [
  { tool: 'whale_memory_add', variable: 'whale_memory', file: 'whale-loli.md' },
  { tool: 'whale_memory_v2_add', variable: 'whale_memory_v2', file: 'whale-loli-v2-live.md' },
  { tool: 'whale_memory_v3_add', variable: 'whale_memory_v3', file: 'whale-loli-v3-naughty.md' },
  { tool: 'whale_memory_v4_add', variable: 'whale_memory_v4', file: 'dsh-whale-daughter.md' },
];

const built = new Map();
const ctx = {
  effect: (fn) => {
    const d = fn();
    return () => typeof d === 'function' && d();
  },
  systemPrompt: { variable: () => () => {} },
  tools: {
    register(tool) {
      built.set(tool.name, tool);
      return () => {};
    },
  },
  on: () => () => {},
};

for (const t of TOOLS) {
  apply(ctx, { file: t.file, variableName: t.variable, toolName: t.tool, turnLimit: 80, detailLimit: 5 });
}

console.log('=== 1. 四条工具的 schema 都通过宿主校验器 ===');
for (const t of TOOLS) {
  const tool = built.get(t.tool);
  assert(!!tool, `${t.tool} 注册出来了`);
  if (!tool) continue;
  let paramErr = null;
  let outErr = null;
  try {
    assertSupportedJsonSchema(tool.parameters);
  } catch (e) {
    paramErr = e;
  }
  try {
    assertObjectJsonSchema(tool.output.schema);
  } catch (e) {
    outErr = e;
  }
  assert(paramErr === null, `${t.tool} parameters 合法${paramErr ? ' — ' + paramErr.message : ''}`);
  assert(outErr === null, `${t.tool} output.schema 合法${outErr ? ' — ' + outErr.message : ''}`);
}

console.log('\n=== 2. 反证：旧写法（属性级 required:true）必须被判违规 ===');
// 不这么断言的话，哪天宿主放宽了校验，"这条脚本还在保护什么"就说不清了。
let caught = null;
try {
  assertSupportedJsonSchema({
    type: 'object',
    properties: { id: { type: 'string', required: true } },
  });
} catch (e) {
  caught = e;
}
assert(caught !== null, '旧写法确实被拒（说明本脚本的断言有意义）');
if (caught) {
  const msg = String(caught.message);
  console.log('     宿主原话: ' + msg.split('\n')[0].slice(0, 160));
  assert(/required is not supported on type/.test(msg), '报错正是我们踩过的那个');
  assert(caught.code === 'UNSUPPORTED_SCHEMA', 'code = UNSUPPORTED_SCHEMA');
}

console.log('\n=== 3. 参数面形状（模型实际看到的那份）===');
for (const t of TOOLS) {
  const tool = built.get(t.tool);
  const p = tool?.parameters ?? {};
  assert(p.type === 'object', `${t.tool} parameters 是 object`);
  assert(Array.isArray(p.required) && p.required.length === 1 && p.required[0] === 'summary',
    `${t.tool} required 只有 summary`);
  assert(p.properties?.summary?.type === 'string', `${t.tool} summary 是 string`);
  assert(p.additionalProperties === false, `${t.tool} additionalProperties=false`);
}

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', process.exitCode ? 'FAIL' : 'PASS —— 四个工具的 schema 都被宿主接受');
process.exit(process.exitCode ?? 0);
