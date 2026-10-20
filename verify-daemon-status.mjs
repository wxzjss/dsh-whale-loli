/**
 * 校验「设置页好感度面板」拿到的数据是真的能用的。
 *
 * 这一条是被线上故障逼出来的：面板只剩一句「还没有哪个预设挂上好感度」，
 * 一个滑块都没有，也设不了值。根因是 daemon 去扫 `~/.dsh/agent-presets/`
 * （现代宿主根本不用这个目录），`wired` 永远是空数组。
 *
 * 所以这里必须锁住三件事：
 *   1. `status()` 一定列全四个预设 —— 哪怕磁盘上一个值都没写过；
 *   2. `wired` 一定非空，而且每条 `affinity === true`（面板靠它决定画几行）；
 *   3. `set(scope, value)` 写的文件，必须**就是预设那边 `affinity.js` 读的那一个**
 *      —— 否则面板调的和你聊天时生效的不是同一份，白调。
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let failed = 0;
const problems = [];

function check(label, ok, detail) {
  if (ok) {
    console.log(`✓ ${label}`);
  } else {
    failed += 1;
    problems.push(`${label}${detail === undefined ? '' : `  ${detail}`}`);
    console.log(`✗ ${label}${detail === undefined ? '' : `  ${detail}`}`);
  }
}

const home = mkdtempSync(join(tmpdir(), 'whale-daemon-status-'));
process.env.DSH_HOME = home;

const daemon = await import('./src/daemon.js');
const affinity = await import('./src/affinity.js');
const presets = await import('./src/presets.js');

const service = new daemon.AffinityDaemon({});

// ── 1. 空磁盘也要列全四个预设 ──────────────────────────────────────────
const fresh = service.status();
check('空磁盘时 presets 也有四条', fresh.presets.length === 4, `实际 ${fresh.presets.length}`);
check(
  '四条正好是四个预设 id',
  JSON.stringify(fresh.presets.map((row) => row.scope)) === JSON.stringify(presets.PRESET_IDS),
  JSON.stringify(fresh.presets.map((row) => row.scope)),
);
check('没写过的预设值都是默认 0', fresh.presets.every((row) => row.value === 0 && row.hasFile === false));
check('每行都带档位名', fresh.presets.every((row) => typeof row.band === 'string' && row.band.length > 0));
check('带了七档说明', fresh.bands.length === 7, `实际 ${fresh.bands.length}`);
check('带了值域', fresh.min === -100 && fresh.max === 100 && fresh.defaultValue === 0);

// ── 2. wired 非空（线上故障点） ────────────────────────────────────────
check('wired 有四条（不再是空数组）', fresh.wired.length === 4, `实际 ${fresh.wired.length}`);
check('四条都是 affinity: true', fresh.wired.every((row) => row.affinity === true));
check('wired 里的 presetId 与 presets 一一对应', JSON.stringify(fresh.wired.map((row) => row.presetId)) === JSON.stringify(fresh.presets.map((row) => row.scope)));
check('wired 里的 scope 就是预设 id（面板按它读写）', fresh.wired.every((row) => row.scope === row.presetId));

// ── 3. 四份状态文件必须各自独立（中文 id 清洗后容易撞名、共用一份）──────
const pathById = presets.PRESETS.map((preset) => affinity.affinityPath(preset.id));
check(
  '四个预设的状态文件路径两两不同',
  new Set(pathById).size === pathById.length,
  pathById.map((file) => file.split(/[\\/]/u).pop()).join(' / '),
);
const countAffinityFiles = () => {
  try {
    return readdirSync(join(home, 'affinity')).length;
  } catch {
    return 0; // 目录还不存在，就是 0 个文件
  }
};
const diskBefore = countAffinityFiles();
service.set(presets.PRESET_IDS[1], 42);
const diskAfter = countAffinityFiles();
check('写一个预设只新增一个文件', diskAfter === diskBefore + 1, `${diskBefore} → ${diskAfter}`);
check(
  '写第二个预设时另外三个仍是默认 0',
  presets.PRESET_IDS.filter((_, index) => index !== 1).every((id) => affinity.readAffinity(id) === 0),
);
service.set(presets.PRESET_IDS[1], 0);

// ── 4. 面板写的 == 预设读的 ────────────────────────────────────────────
for (const preset of presets.PRESETS) {
  const result = service.set(preset.id, 42);
  const expectedPath = affinity.affinityPath(preset.id);
  check(
    `${preset.id}：set 写到预设读的那个文件`,
    result.value === 42 && affinity.readAffinity(preset.id) === 42,
    JSON.stringify(result),
  );
  const after = service.status().presets.find((row) => row.scope === preset.id);
  check(
    `${preset.id}：status 立刻反映 42「明显亲近」`,
    after?.value === 42 && after?.band === '明显亲近' && after?.hasFile === true,
    JSON.stringify(after),
  );
  check(
    `${preset.id}：文件路径与 affinityPath 一致`,
    after?.file === expectedPath.split(/[\\/]/u).pop(),
    `${after?.file} vs ${expectedPath}`,
  );
}

// ── 4. 越界与脏输入 ────────────────────────────────────────────────────
const clamped = service.set(presets.PRESET_IDS[0], 9999);
check('超上限夹到 100', clamped.value === 100, JSON.stringify(clamped));
const negative = service.set(presets.PRESET_IDS[0], -9999);
check('超下限夹到 -100', negative.value === -100, JSON.stringify(negative));
let threw = false;
try {
  service.set('   ', 10);
} catch {
  threw = true;
}
check('空 scope 抛错（不静默写坏文件）', threw);
check('四个预设互不影响', presets.PRESET_IDS.slice(1).every((id) => affinity.readAffinity(id) === 42));

// ── 5. 待机值恢复，别把测试值留在真机上 ────────────────────────────────
for (const preset of presets.PRESETS) service.set(preset.id, 0);
check('恢复后全为 0', presets.PRESET_IDS.every((id) => affinity.readAffinity(id) === 0));

rmSync(home, { recursive: true, force: true });

console.log('');
if (failed === 0) {
  console.log('RESULT: PASS —— 设置页列全四个预设，滑块能设值，写的正是人设读的那份');
  process.exit(0);
}
console.log(`RESULT: FAIL —— ${failed} 项不通过`);
for (const problem of problems) console.log(`  · ${problem}`);
process.exit(1);
