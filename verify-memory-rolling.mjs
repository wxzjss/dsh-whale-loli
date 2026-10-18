// 验证新版记忆规则：两区解析、80 轮滚动、重要记忆不被挤掉、超长先丢旧轮次。
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'whale-roll-'));
process.env.DSH_HOME = home;

const mod = await import('./src/memory.js');

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

const FILE = 'whale-loli.md';
const P = join(home, FILE);

// ── 造一个 100 轮的记忆文件：3 条重要记忆 + 100 轮对话 ──────────────
const turns = Array.from({ length: 100 }, (_, i) => `- 2026-10-18 第${i + 1}轮：主人说事 ${i + 1} / 小鱼答 ${i + 1}`);
writeFileSync(
  P,
  `# 鲸鱼娘记忆 · ${FILE}

> 说明行

## 重要记忆

> 永久区说明

### 关于主人

- 主人叫阿澈。
- 主人不自己写代码。

## 对话记录

> 流水说明

${turns.join('\n')}
`,
  'utf8',
);

console.log('=== 1. 解析 ===');
const parsed = mod.parseMemory(readFileSync(P, 'utf8'));
check('永久区条目保留 2 条', parsed.permanent.includes('主人叫阿澈') && parsed.permanent.includes('主人不自己写代码'));
check('对话轮次解析出 100 轮', parsed.turns.length === 100, `实际 ${parsed.turns.length}`);
check('永久区不含说明行', !parsed.permanent.includes('永久区说明'));
check('永久区保留了 ### 小标题', parsed.permanent.includes('### 关于主人'));

console.log('\n=== 2. 注入只带最近 80 轮 ===');
const c = mod.composeMemory(FILE, { maxChars: 16000, turnLimit: 80 });
check('keptTurns = 80', c.keptTurns === 80, `实际 ${c.keptTurns}`);
check('totalTurns = 100', c.totalTurns === 100);
check('含最新一轮(第100轮)', c.text.includes('第100轮：'));
check('不含第20轮（已滚出）', !c.text.includes('第20轮：'));
check('含第21轮（窗口内最旧）', c.text.includes('第21轮：'));
check('重要记忆仍在', c.text.includes('主人叫阿澈'));
check('横幅显示 共 100 轮', c.text.includes('共 100 轮'));
// 只数「对话记录」区里的条目（永久区也有 `- ` 行，不能一起数）
const logSection = c.text.slice(c.text.indexOf('## 对话记录'));
const injected = (logSection.match(/^- /gm) ?? []).length;
check('注入的对话条数 = 80', injected === 80, `实际 ${injected}`);

console.log('\n=== 3. 重要记忆不占 80 轮名额 ===');
const withPerm = mod.composeMemory(FILE, { turnLimit: 80 });
const permLines = withPerm.text.split('\n').filter((l) => l.startsWith('- ') && !l.includes('轮：'));
check('80 轮之外另有永久条目', permLines.length === 2, `永久条目 ${permLines.length}`);

console.log('\n=== 4. 超长时先丢旧轮次，不丢重要记忆 ===');
const tight = mod.composeMemory(FILE, { maxChars: 1200, turnLimit: 80 });
check('被压缩到 <= 1200', tight.text.length <= 1200, `实际 ${tight.text.length}`);
check('重要记忆仍在', tight.text.includes('主人叫阿澈'));
check('保留的是最新几轮', tight.text.includes('第100轮：'));
check('丢掉了更旧的轮次', !tight.text.includes('第21轮：'));

console.log('\n=== 5. 轮数没满时按 N/80 显示 ===');
writeFileSync(
  P,
  `# 标题\n\n## 重要记忆\n\n- 只有一条永久\n\n## 对话记录\n\n- 第1轮\n- 第2轮\n`,
  'utf8',
);
const small = mod.composeMemory(FILE, { turnLimit: 80 });
check('横幅显示 2/80 轮', small.text.includes('（2/80 轮）'));
check('keptTurns=2', small.keptTurns === 2);

console.log('\n=== 6. pruneMemoryFile 真能裁文件 ===');
writeFileSync(
  P,
  `# 标题\n\n## 重要记忆\n\n- 永久条目\n\n## 对话记录\n\n${turns.join('\n')}\n`,
  'utf8',
);
const pr = mod.pruneMemoryFile(FILE, 80);
check('裁掉 20 轮', pr.pruned === 20, `before=${pr.before} after=${pr.after}`);
const after = readFileSync(P, 'utf8');
check('文件里只剩 80 条对话', (after.match(/^- 2026/gm) ?? []).length === 80);
check('裁剪后重要记忆还在', after.includes('永久条目'));

console.log('\n=== 7. 老格式（无「对话记录」区）不丢内容 ===');
writeFileSync(
  P,
  `# 老文件\n\n> 引用\n\n## 关于主人\n\n- 老格式的一条记忆\n- 老格式的另一条\n`,
  'utf8',
);
const legacy = mod.parseMemory(readFileSync(P, 'utf8'));
check('旧条目全进永久区', legacy.permanent.includes('老格式的一条记忆') && legacy.permanent.includes('老格式的另一条'));
check('轮次为空', legacy.turns.length === 0);
const legacyOut = mod.composeMemory(FILE, { turnLimit: 80 });
check('旧内容仍被注入', legacyOut.text.includes('老格式的一条记忆'));

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', ok ? 'PASS —— 记忆两区 + 80 轮滚动规则成立' : 'FAIL');
process.exit(ok ? 0 : 1);
