// 校验 patch 里每一条 `dsh-whale-loli` 挂载行都被分派到**正确的模块**。
//
// 事故（0.9.10 及以前，线上真实发生）：
//   所有挂载行都用裸包名 `name: 'dsh-whale-loli'`（宿主 client-modules 的
//   `locatePkgJson` 只认裸名），而 `applyEntry` 只判断了 `config.daemon`，
//   于是那些不该进记忆模块的行全落进 `applyMemory()`，`config.file` 缺失就
//   退回默认的 `whale-loli.md` —— 变量被注入**记忆文件正文**，工具也串台。
//   这个脚本是那条教训的守门人：逐行跑**真的** `applyEntry`，看它到底注册了什么。
//
// 0.9.16 起好感度整套删除，patch 里只剩记忆行（`row: memory`）一种；
// 断言改为：记忆行 4 条、每条都注册自己那一个变量与工具、且一条不多。
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

// 本包的行都嵌套在每个预设的 config.plugins 里，必须递归收，
// 只收顶层 insert 会一条都看不到（0.9.10 之后真踩过这个漏检）。
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

// ── 假 ctx：只提供记忆模块真正用到的那几个服务 ─────────────────────────────
function makeCtx() {
  const vars = new Map();
  const tools = new Map();
  const provided = new Map();
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
      fn();
      return () => {};
    },
    get(key) {
      return provided.get(key);
    },
    provide(key, value) {
      provided.set(key, value);
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

// ── 用临时 DSH_HOME，绝不碰真机上的记忆文件 ────────────────────────────────
const home = mkdtempSync(join(tmpdir(), 'whale-dispatch-'));
process.env.DSH_HOME = home;

const indexMod = await import(pathToFileURL(join(process.cwd(), 'src/index.js')).href);
const applyEntry = indexMod.default.apply;
const presetsMod = await import(pathToFileURL(join(process.cwd(), 'src/presets.js')).href);

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[1] 行数与形状');
const memoryRows = ours.filter((r) => r.config?.row === 'memory');
check('记忆行 4 条', memoryRows.length === 4, `实际 ${memoryRows.length}`);
check('没有残留的好感度行（row: affinity）', ours.every((r) => r.config?.row !== 'affinity'));
check('没有残留的守护进程行（daemon: true）', ours.every((r) => r.config?.daemon !== true));
check(
  '每条行都显式带 row 标记（不靠猜）',
  memoryRows.length === ours.length,
  `未被标记的：${ours.filter((r) => r.config?.row === undefined).map((r) => r.id).join(', ') || '无'}`,
);
check('全部用裸包名', ours.every((r) => r.name === 'dsh-whale-loli'));

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[2] 逐行跑真的 applyEntry，看它注册了什么');
const MEMORY_MARKS = ['【鲸鱼记忆', '记忆文件'];

for (const row of memoryRows) {
  const ctx = makeCtx();
  applyEntry(ctx, row.config);
  const varNames = [...ctx.vars.keys()];
  const toolNames = [...ctx.registeredTools.keys()];
  const text = ctx.vars.get(row.config.variableName)?.() ?? '';
  // 记忆行自己不写 scope，靠 file/variableName 与预设清单对上号。
  const preset = presetsMod.PRESETS.find((p) => p.memoryFile === row.config.file);

  check(
    `[${row.id}] 只注册 1 个变量且就是 ${row.config.variableName}`,
    varNames.length === 1 && varNames[0] === row.config.variableName,
    `实际 ${JSON.stringify(varNames)}`,
  );
  check(
    `[${row.id}] 只注册 1 个工具且就是 ${row.config.toolName}`,
    toolNames.length === 1 && toolNames[0] === row.config.toolName,
    `实际 ${JSON.stringify(toolNames)}`,
  );
  check(
    `[${row.id}] 变量内容像记忆（含路径提示）`,
    MEMORY_MARKS.some((m) => text.includes(m)),
    `长度 ${text.length}`,
  );
  check(`[${row.id}] 记忆文件能对上某个预设`, preset !== undefined, `file=${row.config.file}`);
  check(
    `[${row.id}] variableName 与预设清单一致`,
    row.config.variableName === preset?.memoryVariable,
    `行里 ${row.config.variableName} / 清单 ${preset?.memoryVariable}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[3] 反证：把「预设 id」当配置喂进去会退回默认记忆文件');
{
  // 0.9.10 的事故形态 —— config 里没有 file，只剩一个 scope。
  // 现在 applyEntry 只做记忆，这种残缺配置会退回 DEFAULT_MEMORY_FILE，
  // 也就是「变量被注入 whale-loli.md 正文」那一幕。留一条反证守住它。
  const ctx = makeCtx();
  applyEntry(ctx, { row: 'memory', scope: '鲸鱼娘活人版Agent预设', variableName: 'probe_var', toolName: 'probe_add' });
  const text = ctx.vars.get('probe_var')?.() ?? '';
  check(
    '残缺配置确实退回默认记忆文件（说明必须给全 file）',
    text.includes('whale-loli.md'),
    `长度 ${text.length}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════
console.log('\n[4] 人设里记忆占位符只能出现一次，且不引用别人的');
for (const p of presetsMod.PRESETS) {
  const text = readFileSync(join(process.cwd(), 'src', p.personaFile.replace('./', '')), 'utf8');
  const memHits = text.split(`{{${p.memoryVariable}}}`).length - 1;
  const otherMem = presetsMod.PRESETS.filter((q) => q.id !== p.id).filter((q) => text.includes(`{{${q.memoryVariable}}}`));
  const anyAffinity = /affinity_v\d/.test(text) || text.includes('【好感度】');
  check(`[${p.id}] {{${p.memoryVariable}}} 恰好 1 处`, memHits === 1, `实际 ${memHits}`);
  check(`[${p.id}] 没有引用别的预设的记忆变量`, otherMem.length === 0, otherMem.map((q) => q.memoryVariable).join(',') || '无');
  check(`[${p.id}] 没有残留好感度占位符/段落`, !anyAffinity);
}

rmSync(home, { recursive: true, force: true });

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 每条记忆行都只注册自己那份记忆，人设无好感度残留');
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed} 项失败`);
process.exit(1);
