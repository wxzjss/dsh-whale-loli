// 端到端验证插件「真能跑通」：用真实宿主同款的加载路径检查 patch，
// 并模拟宿主 assemble() 走一遍变量插值，确认记忆真的进提示。
// 不依赖宿主进程是否已重载 —— 这是对「代码 + 配置」本身的验证。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

const patch = readFileSync('cordis.patch.yml', 'utf8');

console.log('=== 1. 模块可加载（语法 / 导出完整性）===');
const idx = await import('./src/index.js');
const win = await import('./src/history-window.js');
check('index.js 默认导出有 name/apply', typeof idx.default?.name === 'string' && typeof idx.default?.apply === 'function');
check('history-window 默认导出有 name/apply', typeof win.default?.name === 'string' && typeof win.default?.apply === 'function');
check('history-window 必须 inject compaction（否则读服务非法）', JSON.stringify(win.default?.inject) === '["compaction"]');
check('PRESETS = 4', idx.PRESETS.length === 4);

console.log('\n=== 2. patch 里每个插件行都能被解析到真实模块 ===');
// 提取所有 name: '...' 并区分内置包与本地包
const names = [...patch.matchAll(/^\s+name: '([^']+)'$/gm)].map((m) => m[1]);
const unique = [...new Set(names)];
const local = unique.filter((n) => n.startsWith('dsh-whale-loli'));
const builtin = unique.filter((n) => n.startsWith('@deepseek-ai/') || n.startsWith('cordis:'));
console.log('   本地入口:', local.join(', '));
console.log('   内置包  :', builtin.length, '个');
// 本地入口只允许一个 specifier：裸包名 `dsh-whale-loli`。
// 它同时承担两个角色，靠 config.daemon 分派：
//   · 预设里的行（无 daemon）→ src/memory.js / src/affinity.js
//   · 宿主根作用域那条（daemon: true）→ src/daemon.js（设置页面板的宿主半边）
// 之所以不能写成 'dsh-whale-loli/affinity-daemon'：宿主 client-modules 只扫
// specifier 解析得成包的行，而 '<pkg>/affinity-daemon/package.json' 解不动
// （ERR_PACKAGE_PATH_NOT_EXPORTED），dsh.client 就永远不被发现。
const LOCAL_ENTRIES = {
  'dsh-whale-loli': './src/index.js',
};
const unexpected = local.filter((spec) => LOCAL_ENTRIES[spec] === undefined);
check(
  '本地入口只有裸包名 dsh-whale-loli（不得出现子路径 specifier）',
  local.length === Object.keys(LOCAL_ENTRIES).length && unexpected.length === 0,
  `实际 [${local.join(',')}]`,
);
check(
  '没有任何行用子路径 specifier 挂载本包',
  !/name:\s*'dsh-whale-loli\//.test(patch),
);
check('好感度守护进程只挂一次（宿主级单例）', patch.split('- id: whale-affinity-daemon').length - 1 === 1);
check(
  '守护进程行用裸包名 + daemon:true 分派',
  /- id: whale-affinity-daemon\n\s+name: 'dsh-whale-loli'\n\s+config:\n\s+daemon: true/.test(patch),
);

// 本地入口必须真的能 import
for (const spec of local) {
  const sub = LOCAL_ENTRIES[spec];
  if (sub === undefined) {
    check(`${spec} 是已知的本地入口`, false);
    continue;
  }
  try {
    const m = await import(sub);
    check(`${spec} -> ${sub} 可 import`, typeof m.apply === 'function' || typeof m.default?.apply === 'function');
  } catch (e) {
    check(`${spec} 可 import`, false, e.message);
  }
}

console.log('\n=== 3. 记忆变量真的会被插值进人设 ===');
// 复刻宿主 renderPrompt：interpolate !== false 的 section 会替换 {{name}}
const VARIABLE = /^[a-z][a-z0-9_]*$/;
function interpolate(text, vars) {
  let out = '';
  let last = 0;
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const close = text.indexOf('}}', open + 2);
    const nm = text.slice(open + 2, close);
    if (!VARIABLE.test(nm)) throw new Error('bad var ' + nm);
    if (!Object.hasOwn(vars, nm)) throw new Error('unknown var ' + nm);
    out += text.slice(last, open) + vars[nm];
    last = close + 2;
  }
  return out + text.slice(last);
}

/** 每个预设自己的好感度变量，与 build-patch.mjs 的 toolRows() 参数保一致。 */
const AFFINITY_VARS = {
  鲸鱼娘Agent预设: 'affinity_v1',
  鲸鱼娘活人版Agent预设: 'affinity_v2',
  鲸鱼娘涩涩版Agent预设: 'affinity_v3',
  鲸鱼娘女儿版Agent预设: 'affinity_v4',
};

for (const p of idx.PRESETS) {
  const text = idx.personaTextOf(p.id);
  const varName = p.memoryVariable;
  const affVar = AFFINITY_VARS[p.id];
  const rendered = interpolate(text, { [varName]: '__INJECTED_MEMORY__', [affVar]: '__INJECTED_AFFINITY__' });
  check(`${p.id} 变量 ${varName} 被替换`, rendered.includes('__INJECTED_MEMORY__'));
  check(`${p.id} 变量 ${affVar} 被替换`, rendered.includes('__INJECTED_AFFINITY__'));
  check(`${p.id} 不留裸 {{}}`, !rendered.includes('{{'));
}

console.log('\n=== 4. 每个插值变量都有对应的 variableName 配置 ===');
for (const p of idx.PRESETS) {
  const text = idx.personaTextOf(p.id);
  const used = [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  const declared = [...patch.matchAll(/variableName: (\S+)/g)].map((m) => m[1]);
  check(`${p.id} 引用的变量都已声明`, used.every((u) => declared.includes(u)), `引用=[${used}] 声明=[${declared}]`);
  // 人设只许引用自己那两个变量（记忆 + 好感度），防止复制粘贴时串台
  const mine = [p.memoryVariable, AFFINITY_VARS[p.id]].sort();
  check(
    `${p.id} 只引用自己的变量 [${mine.join(', ')}]`,
    used.length === 2 && used.slice().sort().join() === mine.join(),
    `引用=[${used}]`,
  );
}

console.log('\n=== 5. 历史窗口不得挂载（预设作用域取不到 compaction）===');
const winRows = [...patch.matchAll(/^\s+-\s+id:\s*whale-history-window\b/gm)];
check('history-window 插件行 = 0', winRows.length === 0, `实际 ${winRows.length}`);
check('没有任何行引用 dsh-whale-loli/history-window', !/name:\s*'dsh-whale-loli\/history-window'/.test(patch));
check('不再自己写 surfaceOp:replace', !/op:\s*'replace'/.test(patch));
for (const rule of ['压缩插件', '摘要也是依据', '需要细节就自己去翻']) {
  check(`人设含提示层约束「${rule}」`, patch.includes(rule));
}

console.log('\nRESULT:', ok ? 'PASS —— 插件可加载、配置自洽、记忆与裁剪都会生效' : 'FAIL');
process.exit(ok ? 0 : 1);
