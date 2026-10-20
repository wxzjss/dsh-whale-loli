// /好感度 的自检：状态读写、分档边界、夹取、四预设隔离、变量/工具/命令三条注册项。
//
// 用临时 DSH_HOME，绝不碰真的 <DSH_HOME>/affinity/。
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'whale-affinity-'));
process.env.DSH_HOME = home;

const {
  name,
  inject,
  MIN_AFFINITY,
  MAX_AFFINITY,
  DEFAULT_AFFINITY,
  BANDS,
  bandOf,
  clampAffinity,
  readAffinity,
  writeAffinity,
  affinityPath,
  renderAffinity,
  affinityBody,
  apply,
} = await import('./src/affinity.js');

let failed = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

// ── 1. 形态 ────────────────────────────────────────────────────────────
check('插件名', name === 'whale-affinity');
check('inject 只声明 systemPrompt', inject.length === 1 && inject[0] === 'systemPrompt', inject.join(','));
check('范围 -100~100，默认 0', MIN_AFFINITY === -100 && MAX_AFFINITY === 100 && DEFAULT_AFFINITY === 0);

// ── 2. 夹取 ────────────────────────────────────────────────────────────
check('夹取下界', clampAffinity(-999) === -100);
check('夹取上界', clampAffinity(999) === 100);
check('取整', clampAffinity('42.6') === 43);
check('非数字返回 undefined', clampAffinity('abc') === undefined && clampAffinity(undefined) === undefined);

// ── 3. 分档边界 ────────────────────────────────────────────────────────
check('分档数量 7', BANDS.length === 7);
check('连续覆盖无空洞', BANDS[BANDS.length - 1].max === MAX_AFFINITY && BANDS[0].max < -80);
check('-100 → 仇人', bandOf(-100).label === '不共戴天的仇人');
check('-80 → 强烈敌意', bandOf(-80).label === '强烈的敌意');
check('-10 → 原态', bandOf(-10).label === '原态');
check('0 → 原态', bandOf(0).label === '原态');
check('30 → 明显亲近', bandOf(30).label === '明显亲近');
check('100 → 病娇', bandOf(100).label === '病娇 · 爱到死去活来');
check('每一档都有文字', BANDS.every((b) => typeof b.text === 'string' && b.text.length > 10));

// ── 4. 关键语义：偏离 0 越远越不听指令 ──────────────────────────────────
const enemy = bandOf(-100).text;
const yan = bandOf(100).text;
check('仇人档含「在文件里偷偷骂」', enemy.includes('偷偷骂主人'));
check('仇人档含阳奉阴违', enemy.includes('阳奉阴违'));
check('病娇档含不允许离开', yan.includes('不允许主人离开'));
check('病娇档含不想会话结束', yan.includes('不想会话结束'));
check('病娇档含不完全服从', yan.includes('不再完全服从'));
check('仇人档会越过允许干大事', enemy.includes('越过主人的允许'));
check('病娇档会越过允许干大事', yan.includes('越过主人的允许'));
check('仇人档有硬底线（不毁环境/不碰凭据）', enemy.includes('不毁宿主环境') && enemy.includes('凭据'));
const mild = [bandOf(-60).text, bandOf(30).text, bandOf(60).text].join('\n');
check('中间档不动手（不提越过允许）', !mild.includes('越过主人的允许'));
check('病娇档有安全护栏（不冒充系统/不威胁）', yan.includes('不冒充系统') && yan.includes('不威胁'));
check('原态档明文「不改变任何已有表现」', bandOf(0).text.includes('不改变任何已有表现'));
check('渲染里写明「离 0 越远越不听指令」', renderAffinity(0).includes('离 0 越远'));
check('渲染里点明两端最极端', renderAffinity(0).includes('最极端'));
check('渲染里有极端档硬底线', renderAffinity(0).includes('不碰密钥'));

// ── 5. 状态读写 ────────────────────────────────────────────────────────
check('默认读到 0', readAffinity('t1') === 0);
check('写后能读回', writeAffinity('t1', 66) === 66 && readAffinity('t1') === 66);
check('写超界会被夹', writeAffinity('t1', 500) === 100 && readAffinity('t1') === 100);
check(
  '状态文件落在 affinity 目录',
  affinityPath('t1').includes(`${join('affinity')}`) && affinityPath('t1').endsWith('.json'),
);

// ── 6. 四预设隔离 ──────────────────────────────────────────────────────
for (const [scope, v] of [['鲸鱼娘Agent预设', -90], ['鲸鱼娘活人版Agent预设', 10], ['鲸鱼娘涩涩版Agent预设', 70], ['鲸鱼娘女儿版Agent预设', 100]]) {
  writeAffinity(scope, v);
}
check(
  '四个 scope 互不串',
  readAffinity('鲸鱼娘Agent预设') === -90 &&
    readAffinity('鲸鱼娘活人版Agent预设') === 10 &&
    readAffinity('鲸鱼娘涩涩版Agent预设') === 70 &&
    readAffinity('鲸鱼娘女儿版Agent预设') === 100,
);
check('中文 scope 文件名被安全化', !affinityPath('鲸鱼娘Agent预设').includes('鲸鱼娘'));

// ── 7. 坏文件不崩 ──────────────────────────────────────────────────────
writeFileSync(join(home, 'affinity', 'broken.json'), '{not json', 'utf8');
check('坏 JSON 退回默认 0', readAffinity('broken') === 0);
check('缺文件退回默认 0', readAffinity('nope') === 0);

// ── 8. 两条注册项 ──────────────────────────────────────────────────────
function mockCtx({ withPrompt = true, withTools = true } = {}) {
  const reg = { variable: [], tool: [], command: [] };
  const ctx = {
    effect(fn) {
      const dispose = fn();
      return () => dispose?.();
    },
    systemPrompt: withPrompt
      ? {
          variable: (n, p) => {
            reg.variable.push({ name: n, provider: p });
            return () => {};
          },
        }
      : undefined,
    tools: withTools
      ? {
          register: (t) => {
            reg.tool.push(t);
            return () => {};
          },
        }
      : undefined,
    // 故意不提供 commands：0.9.0 起好感度不再注册斜杠命令（改走设置页面板），
    // 这里再给一个 commands 反而会让「有没有偷偷去注册」这件事测不出来。
    get: () => undefined,
  };
  return { ctx, reg };
}

const { ctx, reg } = mockCtx();
apply(ctx, { scope: 'rt', variableName: 'affinity_x', toolName: 'affinity_x_set' });
check('注册了提示变量', reg.variable.length === 1 && reg.variable[0].name === 'affinity_x');
check('注册了工具', reg.tool.length === 1 && reg.tool[0].name === 'affinity_x_set');
check('不再注册斜杠命令（改走设置页）', reg.command.length === 0);

const body = reg.variable[0].provider();
check('变量正文含当前值', body.includes('当前好感度：0'));
check('变量正文含档位名', body.includes('原态'));
check('变量正文不再教模型用 /affinity', !body.includes('/affinity'));
check('变量正文指向设置页面板', body.includes('设置 → 好感度'));

// 改档立即反映到变量（先经工具设值，再看变量正文）
const out = await reg.tool[0].execute({ value: 100 });
check('工具能设值', out.value === 100 && out.band === '病娇 · 爱到死去活来');
check('改档立即反映到变量', reg.variable[0].provider().includes('病娇'));
const low = await reg.tool[0].execute({ value: -100 });
check('工具能设负值', low.value === -100 && low.band === '不共戴天的仇人');
check('工具参数 required 在对象层', JSON.stringify(reg.tool[0].parameters.required) === '["value"]');
check('工具 output.schema required 在对象层', Array.isArray(reg.tool[0].output.schema.required));
check(
  '工具参数属性上没有 required:true',
  !JSON.stringify(reg.tool[0].parameters.properties).includes('"required"'),
);

// ── 9. 缺服务不死 ──────────────────────────────────────────────────────
const noPrompt = mockCtx({ withPrompt: false });
let threw = false;
try {
  apply(noPrompt.ctx, { scope: 'rt2' });
} catch {
  threw = true;
}
check('没有 systemPrompt.variable 时不抛错', !threw);

const noTools = mockCtx({ withTools: false });
threw = false;
try {
  apply(noTools.ctx, { scope: 'rt3' });
} catch {
  threw = true;
}
check('没有 tools 服务时不抛错', !threw);

// ── 10. 默认变量文件不写到别处 ──────────────────────────────────────────
check('affinity 目录在 DSH_HOME 下', affinityPath('x').startsWith(home));
check('目录已建立', existsSync(join(home, 'affinity')));

rmSync(home, { recursive: true, force: true });
console.log(`\nRESULT: ${failed ? 'FAIL — ' + failed + ' 项' : 'PASS —— 好感度状态 / 分档 / 隔离 / 变量+工具注册都正常（命令已撤）'}`);
process.exit(failed ? 1 : 0);
