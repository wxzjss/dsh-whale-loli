// 验证新版记忆规则（固定记忆永久 + 滚动摘要 80 条 FIFO + 详细区 + 归档）。
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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

/** 拼一份符合新格式的记忆文件。rollText / detailText 必须落在各自区内。 */
const build = ({ rollText = '', detailText = '' } = {}) => `# 鲸鱼娘记忆 · ${FILE}

> 说明行

# 固定记忆（不自动删除，定期合并去重）

## 任务目标

- 把插件做好并发布。

## 用户约束/偏好

- 主人要短句，不要小作文。

## 待办

- 还没做汉化。

# 滚动摘要（最多80条，FIFO）

${rollText}
# 最近详细区（最近 5 轮保留更详细摘要或原文）

${detailText}
# 归档索引

`;

console.log('=== 1. 解析四个区 ===');
{
  const turns = Array.from({ length: 100 }, (_, i) => `- R${String(i + 1).padStart(4, '0')} [2026-10-19 12:0${i % 10}] 摘要：第${i + 1}轮`);
  writeFileSync(P, build({ rollText: turns.join('\n') }), 'utf8');
  const parsed = mod.parseMemory(readFileSync(P, 'utf8'));
  check('固定区含任务目标', parsed.fixed.includes('把插件做好并发布'));
  check('固定区含偏好', parsed.fixed.includes('主人要短句'));
  check('固定区不含说明行', !parsed.fixed.includes('说明行'));
  check('固定区保留 ## 小标题', parsed.fixed.includes('## 任务目标'));
  check('固定区丢掉空小节（无 关键决策）', !parsed.fixed.includes('## 关键决策'));
  check('滚动区解析 100 条', parsed.roll.length === 100, `实际 ${parsed.roll.length}`);
  check('R 行带编号', parsed.roll[0]?.id === 'R0001' && parsed.roll[99]?.id === 'R0100');
}

console.log('\n=== 2. 注入只带最近 80 条 ===');
{
  const c = mod.composeMemory(FILE, { maxChars: 16000, turnLimit: 80, detailLimit: 5 });
  check('keptRoll = 80', c.keptRoll === 80, `实际 ${c.keptRoll}`);
  check('totalRoll = 100', c.totalRoll === 100);
  check('含 R0100', c.text.includes('R0100'));
  check('不含 R0020（已滚出）', !c.text.includes('R0020 '));
  check('含 R0021（窗口内最旧）', c.text.includes('R0021 '));
  check('固定记忆仍在', c.text.includes('把插件做好并发布'));
  const rollSection = c.text.slice(c.text.indexOf('# 滚动摘要'));
  const n = (rollSection.match(/^- R\d+/gm) ?? []).length;
  check('注入的滚动条数 = 80', n === 80, `实际 ${n}`);
}

console.log('\n=== 3. 固定记忆不占 80 条名额 ===');
{
  const c = mod.composeMemory(FILE, { turnLimit: 80 });
  const fixedPart = c.text.slice(0, c.text.indexOf('# 滚动摘要'));
  const n = (fixedPart.match(/^- /gm) ?? []).length;
  check('固定区条目独立存在（3 条）', n === 3, `实际 ${n}`);
}

console.log('\n=== 4. 超长先丢旧滚动条，固定记忆最后动 ===');
{
  const c = mod.composeMemory(FILE, { maxChars: 1500, turnLimit: 80, detailLimit: 5 });
  check('被压到 <= 1500', c.text.length <= 1500, `实际 ${c.text.length}`);
  check('固定记忆仍在', c.text.includes('把插件做好并发布'));
  check('保留最新', c.text.includes('R0100'));
}

console.log('\n=== 5. appendRolling 递增编号 + 溢出归档 ===');
{
  const turns = Array.from({ length: 80 }, (_, i) => `- R${String(i + 1).padStart(4, '0')} [t] 摘要：第${i + 1}轮`);
  writeFileSync(P, build({ rollText: turns.join(String.fromCharCode(10)) }), 'utf8');

  const r81 = mod.appendRolling(FILE, '第81轮聊了记忆格式', { turnLimit: 80, detailLimit: 5, date: new Date('2026-10-19') });
  check('新编号是 R0081', r81.id === 'R0081', `实际 ${r81.id}`);
  check('归档了 1 条', r81.archived === 1, `实际 ${r81.archived}`);

  const after = mod.parseMemory(readFileSync(P, 'utf8'));
  check('文件里仍只有 80 条', after.roll.length === 80, `实际 ${after.roll.length}`);
  check('R0001 已滚出', !after.roll.some((x) => x.id === 'R0001'));
  check('R0081 在文件里', after.roll.some((x) => x.id === 'R0081'));
  check('详细区含 R0081', after.detail.includes('R0081'));
  check('归档索引有记录', after.archive.length === 1, `实际 ${after.archive.length}`);

  const archFile = join(home, 'archive', 'whale-loli', '2026-10-19.md');
  check('归档文件已生成', existsSync(archFile));
  check('归档内容含 R0001', existsSync(archFile) && readFileSync(archFile, 'utf8').includes('R0001'));
  check('归档索引指向正确路径', after.archive[0].includes('archive/whale-loli/2026-10-19.md'));
}

console.log('\n=== 6. 归档按预设分目录（三个互不覆盖） ===');
{
  const a = mod.archiveDir('whale-loli.md');
  const b = mod.archiveDir('whale-loli-v2-live.md');
  const c = mod.archiveDir('whale-loli-v3-naughty.md');
  check('三个归档目录互不相同', new Set([a, b, c]).size === 3);
  check('目录名带各自 stem', a.endsWith('whale-loli') && b.endsWith('whale-loli-v2-live') && c.endsWith('whale-loli-v3-naughty'));
}

console.log('\n=== 7. pruneMemoryFile ===');
{
  const turns = Array.from({ length: 100 }, (_, i) => `- R${String(i + 1).padStart(4, '0')} [t] 摘要：第${i + 1}轮`);
  writeFileSync(P, build({ rollText: turns.join(String.fromCharCode(10)) }), 'utf8');
  const pr = mod.pruneMemoryFile(FILE, 80, { detailLimit: 5, date: new Date('2026-10-19') });
  check('裁掉 20 条', pr.archived === 20, `before=${pr.before} after=${pr.after}`);
  const after = readFileSync(P, 'utf8');
  check('文件剩 80 条', (after.match(/^- R\d+/gm) ?? []).length === 80);
  check('固定记忆保留', after.includes('把插件做好并发布'));
}

console.log('\n=== 8. 旧格式兼容（无分区标题）===');
{
  writeFileSync(P, `# 老文件\n\n> 引用\n\n## 关于主人\n\n- 老格式的一条记忆\n- 老格式的另一条\n`, 'utf8');
  const legacy = mod.parseMemory(readFileSync(P, 'utf8'));
  check('旧条目全进固定区', legacy.fixed.includes('老格式的一条记忆') && legacy.fixed.includes('老格式的另一条'));
  check('滚动区为空', legacy.roll.length === 0);
  check('旧内容仍被注入', mod.composeMemory(FILE).text.includes('老格式的一条记忆'));
}

console.log('\n=== 9. 空骨架不注入 ===');
{
  writeFileSync(P, mod.memoryTemplate(FILE), 'utf8');
  check('只有骨架 → 注入空串', mod.composeMemory(FILE).text === '');
}

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', ok ? 'PASS —— 固定记忆 + 80 条滚动 + 详细区 + 归档 规则成立' : 'FAIL');
process.exit(ok ? 0 : 1);

