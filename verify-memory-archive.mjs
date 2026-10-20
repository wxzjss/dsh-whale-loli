// 验证「滚动摘要超 80 条 → 每轮结束自动归档并瘦身文件」。
// 这是之前如实承认的缺口：注入会截断，但文件不瘦身、archive/ 永远空。
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'whale-trim-'));
process.env.DSH_HOME = home;

const mod = await import('./src/memory.js');

let ok = true;
const check = (label, cond, extra = '') => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '  ' + extra : ''));
  if (!cond) ok = false;
};

/** 造一个有 N 条滚动摘要 + 少量固定记忆的文件。 */
function seed(file, n) {
  const roll = Array.from({ length: n }, (_, i) => `- R${String(i + 1).padStart(4, '0')} [t] 摘要：第 ${i + 1} 条`).join('\n');
  writeFileSync(
    join(home, file),
    [
      `# 鲸鱼娘记忆 · ${file}`,
      '',
      '# 固定记忆（不自动删除，定期合并去重）',
      '',
      '## 关键事实（已验证）',
      '',
      '- 主人喜欢夜宵',
      '',
      '# 滚动摘要（最多80条，FIFO）',
      '',
      roll,
      '',
      '# 最近详细区（最近 5 轮保留更详细摘要或原文）',
      '',
      '最近这轮说了点细节',
      '',
      '# 归档索引',
      '',
    ].join('\n'),
    'utf8',
  );
}

function countRoll(file) {
  const raw = readFileSync(join(home, file), 'utf8');
  return mod.parseMemory(raw).roll.length;
}

/** 用假 ctx 跑 apply，并手动触发 agent/status idle。 */
function mount(file, variableName) {
  const vars = new Map();
  const tools = new Map();
  const listeners = new Map();
  const ctx = {
    get: () => undefined,
    effect: (fn) => fn(),
    on: (name, cb) => {
      listeners.set(name, cb);
      return () => {};
    },
    tools: {
      register: (tool) => {
        tools.set(tool.name, tool);
        return () => {};
      },
    },
    systemPrompt: {
      variable: (n, p) => {
        vars.set(n, p);
        return () => {};
      },
      section: () => {
        throw new Error('不应注册 section');
      },
      getSectionOrder: () => 0,
    },
  };
  mod.apply(ctx, { file, variableName, toolName: `${variableName}_add`, turnLimit: 80, detailLimit: 5 });
  return { vars, tools, listeners };
}

console.log('=== 1. 85 条 → 一轮结束后归档 5 条、文件瘦到 80 ===');
{
  const FILE = 'whale-loli.md';
  seed(FILE, 85);
  check('初始 85 条', countRoll(FILE) === 85, `实际 ${countRoll(FILE)}`);

  const { vars, listeners } = mount(FILE, 'whale_memory');
  // 注入时就只喂最新 80 条
  const injected = vars.get('whale_memory')();
  const injectedLines = injected.split('\n').filter((l) => /^- R\d{4}/.test(l.trim()));
  check('注入只含 80 条', injectedLines.length === 80, `实际 ${injectedLines.length}`);
  check('注入保留了最新一条 R0085', injected.includes('R0085'));
  check('注入不含被挤掉的 R0005', !injected.includes('R0005'));

  // 文件此刻还没瘦身（热路径不写盘）
  check('组装时文件未瘦身（仍 85）', countRoll(FILE) === 85, `实际 ${countRoll(FILE)}`);

  // 一轮结束 → idle
  const onStatus = listeners.get('agent/status');
  check('注册了 agent/status 监听', typeof onStatus === 'function');
  onStatus({ status: 'running' });
  check('running 时不动文件', countRoll(FILE) === 85, `实际 ${countRoll(FILE)}`);

  onStatus({ status: 'idle' });
  check('idle 后文件瘦到 80', countRoll(FILE) === 80, `实际 ${countRoll(FILE)}`);
  check('保留的是最新的 R0085', readFileSync(join(home, FILE), 'utf8').includes('R0085'));
  check('旧的 R0001 已离开滚动区', !/^- R0001/m.test(readFileSync(join(home, FILE), 'utf8')));

  // 归档
  const archiveRoot = join(home, 'archive');
  check('archive 目录已创建', existsSync(archiveRoot));
  const stemDirs = existsSync(archiveRoot) ? readdirSync(archiveRoot) : [];
  check('按预设名分目录', stemDirs.includes('whale-loli'), `实际 [${stemDirs.join(',')}]`);
  const archivedFiles = existsSync(archiveRoot) ? readdirSync(join(archiveRoot, 'whale-loli')) : [];
  check('生成了归档文件', archivedFiles.length === 1, `实际 [${archivedFiles.join(',')}]`);
  const archived = archivedFiles.length ? readFileSync(join(archiveRoot, 'whale-loli', archivedFiles[0]), 'utf8') : '';
  check('归档里含被挤掉的 5 条', ['R0001', 'R0002', 'R0003', 'R0004', 'R0005'].every((r) => archived.includes(r)));
  check('固定记忆没有被归档', !archived.includes('主人喜欢夜宵'));

  const after = readFileSync(join(home, FILE), 'utf8');
  check('固定记忆仍在文件里', after.includes('主人喜欢夜宵'));
  check('归档索引写进了文件', after.includes('archive/'));
}

console.log('\n=== 2. 不足 80 条 → 不写盘、不归档 ===');
{
  const FILE = 'whale-loli-v2-live.md';
  seed(FILE, 3);
  const before = readFileSync(join(home, FILE), 'utf8');
  const { listeners } = mount(FILE, 'whale_memory_v2');
  listeners.get('agent/status')({ status: 'idle' });
  check('文件内容完全没变', readFileSync(join(home, FILE), 'utf8') === before);
  check('没有为它建归档目录', !existsSync(join(home, 'archive', 'whale-loli-v2-live')));
}

console.log('\n=== 3. 三个预设的归档互不覆盖 ===');
{
  seed('whale-loli-v3-naughty.md', 82);
  const { listeners } = mount('whale-loli-v3-naughty.md', 'whale_memory_v3');
  listeners.get('agent/status')({ status: 'idle' });
  const dirs = readdirSync(join(home, 'archive')).sort();
  check('两个预设各一个目录', dirs.includes('whale-loli') && dirs.includes('whale-loli-v3-naughty'), `实际 [${dirs.join(',')}]`);
  const v3files = readdirSync(join(home, 'archive', 'whale-loli-v3-naughty'));
  const v3 = readFileSync(join(home, 'archive', 'whale-loli-v3-naughty', v3files[0]), 'utf8');
  check('v3 归档只含自己的条目', v3.includes('R0001') && !v3.includes('R0085'));
  check('v1 归档没有被 v3 污染', !readFileSync(join(home, 'archive', 'whale-loli', readdirSync(join(home, 'archive', 'whale-loli'))[0]), 'utf8').includes('R0082'));
}

console.log('\n=== 4. 文件缺失时 idle 不炸 ===');
{
  const { listeners } = mount('never-existed.md', 'whale_memory_x');
  let threw = false;
  try {
    listeners.get('agent/status')({ status: 'idle' });
  } catch {
    threw = true;
  }
  check('没有抛错', !threw);
}

rmSync(home, { recursive: true, force: true });
console.log('\nRESULT:', ok ? 'PASS —— 超 80 条会自动归档并瘦身，三个预设互不覆盖' : 'FAIL');
process.exit(ok ? 0 : 1);
