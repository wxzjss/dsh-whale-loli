// 校验 patch 里每一条 `dsh-whale-loli` 挂载行都被分派到**正确的模块**。
//
// 事故（0.9.10 及以前，线上真实发生）：
//   为了让宿主 client-modules 能发现本包（`locatePkgJson` 只认裸包名，见
//   verify-client-discovery.mjs），所有挂载行都改成了 `name: 'dsh-whale-loli'`，
//   而 `applyEntry` 只判断了 `config.daemon`，于是 4 条 `whale-affinity` 行全部
//   落进 `applyMemory()`。记忆插件不认识 scope，`config.file` 缺失就退回默认的
//   `whale-loli.md`，结果：
//     · `{{affinity_v1}}` 注入的是**记忆文件正文** —— 人设的好感度段变成第二份记忆，
//       好感度滑块改了也不会有任何可见变化；
//     · 每个预设多出一个把摘要写进 whale-loli.md 的 `affinity_vN_set` 工具（工具串台）。
//   这个脚本就是那条教训的守门人：逐行跑**真的** `applyEntry`，看它到底注册了什么。
//
// 用法：node verify-row-dispatch.mjs [cordis.patch.yml]
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireDshRoot } from './lib/dsh-root.mjs';

const patchFile = (process.argv[2] ?? '').trim() || 'cordis.patch.yml';

let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? `  ${detail}` : ''}`);
  }
};

// ── 解析 patch（借宿主自带 js-yaml，解析行为与宿主一致）────────────────────
let yaml;
try {
  const DSH_ROOT = requireDshRoot('js-yaml');
  const mod = await import(pathToFileURL(join(DSH_ROOT, 'node_modules/js-yaml/index.js')).href);
  yaml = mod.default ?? mod;
} catch (e) {
  console.log(`[skip] 找不到宿主的 js-yaml（设 DSH_ROOT 指向 DSH 安装目录可启用本测试）：${e.message}`);
  console.log('RESULT: SKIP');
  process.exit(0);
}

class JsTag extends yaml.Type {
  constructor() {
    super('tag:yaml.org,2002:js', { kind: 'scalar' });
  }
  resolve(data) {
    return { __js: data };
  }
}

const doc = yaml.load(readFileSync(patchFile, 'utf8'), { schema: yaml.DEFAULT_SCHEMA.extend([new JsTag()]) });

// 本包的行有两种位置：宿主级 insert 顶层，以及**嵌套在每个预设的 config.plugins 里**。
// 两种都要收，否则只会看到 daemon 那一条（0.9.10 之后真踩过这个漏检）。
const collect = (list, out = []) => {
  for (const row of Array.isArray(list) ? list : []) {
    if (row?.name === 'dsh-whale-loli') out.push(row);
    if (Array.isArray(row?.config?.plugins)) collect(row.config.plugins, out);
    if (Array.isArray(row?.config)) collect(row.config, out);
  }
  return out;
};
const rows = doc.flatMap((e) => (Array.isArray(e.insert) ? e.insert : []));
const ours = collect(rows);

console.log(`patch: ${patchFile}`);
console.log(`本包挂载行：${ours.length} 条`);

// ── 假 ctx：只提供三个模块真正用到的那几个服务 ─────────────────────────────
function makeCtx() {
  const vars = new Map();
  const tools = new Map();
  const provided = new Map();
  const effects = [];
  const ctx = {
    vars,
    registeredTools: tools,
    provided,
    systemPrompt: {
      variable(name, provider) {
        vars.set(name, provider);
        return () => vars.delete(name);
      },
      section() {
        throw new Error('不该注册 section（persona 是 complete:true，会丢）');
      },
    },
    on() {
      return () => {};
    },
    effect(fn) {
      const dispose = fn();
      effects.push(dispose);
      return () => {};
    },
    get(key) {
      return provided.get(key);
    },
    provide(key, value) {
      provided.set(key, value);
    },
    reflect: {
      props: {},
      provide(key, value) {
        provided.set(key, value);
        ctx.reflect.props[key] = { type: 'service' };
      },
    },
    inject() {
      return () => {};
    },
  };
  ctx.tools = {
    register(def) {
      tools.set(def.name, def);
      return () => tools.delete(def.name);
    },
  };
  return ctx;
}

// ── 用临时 DSH_HOME，绝不碰真机上的好感度/记忆文件 ──────────────────────────
const home = mkdtempSync(join(tmpdir(), 'whale-dispatch-'));
process.env.DSH_HOME = home;

const indexMod = await import(pathToFileURL(join(process.cwd(), 'src/index.js')).href);
const applyEntry = indexMod.default.apply;
const presetsMod = await import(pathToFileURL(join(process.cwd(), 'src/presets.js')).href);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] 行数与形状');
const daemonRows = ours.filter((r) => r.config?.daemon === true);
const affinityRows = ours.filter((r) => r.config?.row === 'affinity');
const memoryRows = ours.filter((r) => r.config?.row === 'memory');
check('daemon 行 1 条', daemonRows.length === 1);
check('记忆行 4 条', memoryRows.length === 4);
check('好感度行 4 条', affinityRows.length === 4);
check(
  '每条行都显式带 row 标记（不靠猜）',
  memoryRows.length + affinityRows.length + daemonRows.length === ours.length,
  `未被标记的：${ours.filter((r) => r.config?.row === undefined && r.config?.daemon !== true).map((r) => r.id).join(', ') || '无'}`,
);
check('全部用裸包名（client 发现机制要求）', ours.every((r) => r.name === 'dsh-whale-loli'));

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] 逐行跑真的 applyEntry，看它注册了什么');
const MEMORY_MARKS = ['【鲸鱼记忆', '# 固定记忆', '滚动摘要'];
const AFFINITY_MARKS = ['当前好感度：', '档次：'];

for (const row of memoryRows) {
  const ctx = makeCtx();
  applyEntry(ctx, row.config);
  const varNames = [...ctx.vars.keys()];
  const toolNames = [...ctx.registeredTools.keys()];
  const text = ctx.vars.get(row.config.variableName)?.() ?? '';
  check(`[${row.id}] 注册变量 ${row.config.variableName}`, varNames.includes(row.config.variableName), `实际 ${JSON.stringify(varNames)}`);
  check(`[${row.id}] 注册工具 ${row.config.toolName}`, toolNames.includes(row.config.toolName), `实际 ${JSON.stringify(toolNames)}`);
  check(`[${row.id}] 没跑到好感度模块去`, varNames.every((n) => !n.startsWith('affinity')), JSON.stringify(varNames));
  check(
    `[${row.id}] 变量内容像记忆（含路径提示）`,
    text.includes('【鲸鱼记忆') || text.includes('记忆文件'),
    `长度 ${text.length}`,
  );
  check(`[${row.id}] 变量内容不是好感度`, !text.includes('当前好感度'));
}

for (const row of affinityRows) {
  const ctx = makeCtx();
  applyEntry(ctx, row.config);
  const varNames = [...ctx.vars.keys()];
  const toolNames = [...ctx.registeredTools.keys()];
  const text = ctx.vars.get(row.config.variableName)?.() ?? '';
  check(`[${row.id}] 注册变量 ${row.config.variableName}`, varNames.includes(row.config.variableName), `实际 ${JSON.stringify(varNames)}`);
  check(`[${row.id}] 注册工具 ${row.config.toolName}`, toolNames.includes(row.config.toolName), `实际 ${JSON.stringify(toolNames)}`);
  check(
    `[${row.id}] 没有跑进记忆模块（这是 0.9.10 的真事故）`,
    varNames.every((n) => !n.startsWith('whale_memory')) && toolNames.every((n) => !n.startsWith('whale_memory')),
    `变量 ${JSON.stringify(varNames)} / 工具 ${JSON.stringify(toolNames)}`,
  );
  check(
    `[${row.id}] 变量内容是好感度，不是记忆`,
    AFFINITY_MARKS.every((m) => text.includes(m)) && MEMORY_MARKS.every((m) => !text.includes(m)),
    `长度 ${text.length}`,
  );
  check(
    `[${row.id}] scope 就是预设 id`,
    row.config.scope === presetsMod.presetById(row.config.scope)?.id,
    String(row.config.scope),
  );
}

for (const row of daemonRows) {
  const ctx = makeCtx();
  applyEntry(ctx, row.config);
  check('[daemon] 提供 whale-affinity-daemon 服务', ctx.provided.has('whale-affinity-daemon'), JSON.stringify([...ctx.provided.keys()]));
  check('[daemon] 不注册任何提示变量', ctx.vars.size === 0, JSON.stringify([...ctx.vars.keys()]));
  check('[daemon] 不注册任何工具', ctx.registeredTools.size === 0, JSON.stringify([...ctx.registeredTools.keys()]));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] 反证：老的「一律 applyMemory」写法会复现事故');
{
  const memoryMod = await import(pathToFileURL(join(process.cwd(), 'src/memory.js')).href);
  const row = affinityRows[0];
  const ctx = makeCtx();
  memoryMod.apply(ctx, row.config); // 故意的错误分派
  const text = ctx.vars.get(row.config.variableName)?.() ?? '';
  check(
    '错误分派确实把记忆塞进了好感度变量',
    text.includes('【鲸鱼记忆') || text.includes('记忆文件'),
    `长度 ${text.length}`,
  );
  check('错误分派不会产出好感度语义', !text.includes('当前好感度'));
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] 人设里每类占位符只能出现一次');
for (const p of presetsMod.PRESETS) {
  const text = readFileSync(join(process.cwd(), 'src', p.personaFile.replace('./', '')), 'utf8');
  const memHits = text.split(`{{${p.memoryVariable}}}`).length - 1;
  const affHits = text.split(`{{${p.affinityVariable}}}`).length - 1;
  const otherMem = presetsMod.PRESETS.filter((q) => q.id !== p.id).filter((q) => text.includes(`{{${q.memoryVariable}}}`));
  const otherAff = presetsMod.PRESETS.filter((q) => q.id !== p.id).filter((q) => text.includes(`{{${q.affinityVariable}}}`));
  check(`[${p.id}] {{${p.memoryVariable}}} 恰好 1 处`, memHits === 1, `实际 ${memHits}`);
  check(`[${p.id}] {{${p.affinityVariable}}} 恰好 1 处`, affHits === 1, `实际 ${affHits}`);
  check(`[${p.id}] 没有引用别的预设的记忆变量`, otherMem.length === 0, otherMem.map((q) => q.memoryVariable).join(',') || '无');
  check(`[${p.id}] 没有引用别的预设的好感度变量`, otherAff.length === 0, otherAff.map((q) => q.affinityVariable).join(',') || '无');
}

rmSync(home, { recursive: true, force: true });

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 每一条挂载行都分派到自己那个模块，好感度变量里不再是记忆正文');
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed} 项失败`);
process.exit(1);
