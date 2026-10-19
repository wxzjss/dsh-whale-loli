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
check('PRESETS = 3', idx.PRESETS.length === 3);

console.log('\n=== 2. patch 里每个插件行都能被解析到真实模块 ===');
// 提取所有 name: '...' 并区分内置包与本地包
const names = [...patch.matchAll(/^\s+name: '([^']+)'$/gm)].map((m) => m[1]);
const unique = [...new Set(names)];
const local = unique.filter((n) => n.startsWith('dsh-whale-loli'));
const builtin = unique.filter((n) => n.startsWith('@deepseek-ai/') || n.startsWith('cordis:'));
console.log('   本地入口:', local.join(', '));
console.log('   内置包  :', builtin.length, '个');
check('本地入口含记忆插件', local.includes('dsh-whale-loli'));
check('本地入口含 history-window', local.includes('dsh-whale-loli/history-window'));

// 本地入口必须真的能 import
for (const spec of local) {
  const sub = spec === 'dsh-whale-loli' ? './src/index.js' : './src/history-window.js';
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

for (const p of idx.PRESETS) {
  const text = p.personaFile === './persona.md' ? idx.personaText
    : p.personaFile === './persona-v2-live.md' ? idx.personaTextV2 : idx.personaTextV3;
  const varName = { 'whale-loli.md': 'whale_memory', 'whale-loli-v2-live.md': 'whale_memory_v2', 'whale-loli-v3-naughty.md': 'whale_memory_v3' }[p.memoryFile];
  const rendered = interpolate(text, { [varName]: '__INJECTED_MEMORY__' });
  check(`${p.id} 变量 ${varName} 被替换`, rendered.includes('__INJECTED_MEMORY__'));
  check(`${p.id} 不留裸 {{}}`, !rendered.includes('{{'));
}

console.log('\n=== 4. 每个插值变量都有对应的 variableName 配置 ===');
for (const p of idx.PRESETS) {
  const text = p.personaFile === './persona.md' ? idx.personaText
    : p.personaFile === './persona-v2-live.md' ? idx.personaTextV2 : idx.personaTextV3;
  const used = [...new Set([...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
  const declared = [...patch.matchAll(/variableName: (\S+)/g)].map((m) => m[1]);
  check(`${p.id} 引用的变量都已声明`, used.every((u) => declared.includes(u)), `引用=[${used}] 声明=[${declared}]`);
}

console.log('\n=== 5. 历史窗口挂在每个预设里（走宿主压缩服务）===');
const winRows = [...patch.matchAll(/name: 'dsh-whale-loli\/history-window'\n\s+config:\n\s+enable: (\w+)\n\s+keepTurns: (\d+)/g)];
check('history-window 行 = 3', winRows.length === 3, `实际 ${winRows.length}`);
check('全部默认开启', winRows.every((m) => m[1] === 'true'));
check('全部 keepTurns=20', winRows.every((m) => Number(m[2]) === 20));
check('不再自己写 surfaceOp:replace', !/op:\s*'replace'/.test(patch));
for (const rule of ['不被动', '可以主动去找', '默认当它不存在']) {
  check(`人设含提示层约束「${rule}」`, patch.includes(rule));
}

console.log('\nRESULT:', ok ? 'PASS —— 插件可加载、配置自洽、记忆与裁剪都会生效' : 'FAIL');
process.exit(ok ? 0 : 1);
