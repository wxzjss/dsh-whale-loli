/**
 * whale-memory —— 鲸鱼娘的「长期记忆」记忆行。
 *
 * ── 为什么是变量，而不是独立 section ──────────────────────────────────
 *
 * `@deepseek-ai/dsh-system-prompt` 的 assemble() 末尾有这么一段（lib/index.js:401）：
 *
 *     return { ...transformed,
 *              sections: completeSection === void 0 ? transformed.sections : [completeSection] }
 *
 * 意思是：**只要组合里存在一个 `complete: true` 的 section，最终提示就只剩它一个**，
 * 其余 section 全被丢掉。本包三个预设的 persona 都是 `complete: true`（照官方 minimal
 * 的写法，用来把 harness 身份、工具说明等统统剥掉），所以早先那种「另注册一个
 * section 放记忆」的做法**从来没生效过**：实测本机 34 条真实系统提示里，记忆段出现 0 次。
 *
 * 正确入口是 **prompt variable**：complete section 本身仍会被插值
 * （renderPrompt 对 `interpolate !== false` 的 section 调 interpolate），
 * 于是把记忆注册成变量 `{{whale_memory}}`、再让人设 prefix 引用它，
 * 记忆就会随人设一起进入最终提示。
 *
 * 本模块因此：
 *   1. 注册一个 variable（默认 `whale_memory`），provider 每次组装时实时读盘；
 *   2. 默认**不再**注册独立 section（在 complete 预设里那是死代码）；
 *      传 `emitSection: true`（给非 complete 预设用）才额外注册。
 *
 * ── 记忆文件格式（区标题单独一行，内容写在标题行下面）───────────────
 *
 *     # 固定记忆（不自动删除，定期合并去重）
 *     ## 任务目标
 *     ## 用户约束/偏好
 *     ## 当前状态
 *     ## 待办
 *     ## 关键决策
 *     ## 关键事实（已验证）
 *     ## 文件/路径/命令
 *     ## 错误与修复
 *     # 滚动摘要（最多80条，FIFO）
 *     - R0001 [时间] 摘要：...
 *     # 最近详细区（最近 3~5 轮保留更详细摘要或原文）
 *     - R0081 ...
 *     # 归档索引
 *     - archive/<stem>/2026-10-19.md（10 条）
 *
 * 固定区永久保留；滚动区上限 turnLimit（默认 80），超出的从最旧滚出并归档到
 * archive/<stem>/YYYY-MM-DD.md，同时在归档索引里记一笔。
 *
 * 多预设隔离：同一个包被挂载多次（每个预设一次），各自用不同的
 * `variableName` / `file` 区分，所以三份记忆互不相通。变量名必须匹配 [a-z][a-z0-9_]*。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'whale-memory';

/**
 * 需要 prompt registry（读记忆）与 tool registry（写记忆）。
 *
 * `tools` 是后加的：早先只注册变量、不注册工具，于是人设里写着「每轮都要往
 * 滚动摘要加一条」，agent 手里却没有笔 —— 实测新会话连聊十几轮，文件里一条
 * 都没多。写入必须由 agent 主动调工具完成，所以这一项是硬依赖。
 */
export const inject = ['systemPrompt', 'tools'];

/** 默认记忆文件名（放在 <DSH_HOME> 下）。 */
export const DEFAULT_MEMORY_FILE = 'whale-loli.md';

/** 默认变量名。 */
export const DEFAULT_VARIABLE = 'whale_memory';

/** 默认 section 名（仅 emitSection: true 时使用）。 */
export const MEMORY_SECTION = 'whale-loli-memory';

/** 注入总长上限。 */
export const MEMORY_MAX_CHARS = 16000;

/** 滚动摘要上限（条）。固定记忆不占这个名额。 */
export const DEFAULT_TURN_LIMIT = 80;

/** 最近详细区保留多少轮。 */
export const DEFAULT_DETAIL_LIMIT = 5;

/** 固定区标题。 */
export const ZONE_FIXED = '# 固定记忆';

/** 滚动摘要区标题。 */
export const ZONE_ROLL = '# 滚动摘要';

/** 最近详细区标题。 */
export const ZONE_DETAIL = '# 最近详细区';

/** 归档索引区标题。 */
export const ZONE_ARCHIVE = '# 归档索引';

/** 固定区的 8 个小节（顺序即写入顺序）。 */
export const FIXED_SECTIONS = [
  '## 任务目标',
  '## 用户约束/偏好',
  '## 当前状态',
  '## 待办',
  '## 关键决策',
  '## 关键事实（已验证）',
  '## 文件/路径/命令',
  '## 错误与修复',
];

/** DSH 家目录：DSH_HOME 优先，否则 ~/.dsh。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** 解析记忆文件路径（绝对路径原样，否则挂到 DSH 家目录下）。 */
export function memoryPath(file = DEFAULT_MEMORY_FILE) {
  if (!file) return join(dshHome(), DEFAULT_MEMORY_FILE);
  if (/^[a-zA-Z]:[\\/]/.test(file) || file.startsWith('/') || file.startsWith('\\')) return file;
  return join(dshHome(), file);
}

/** 记忆文件不带扩展名的名字，用作归档子目录名（三个预设各自独立）。 */
export function memoryStem(file = DEFAULT_MEMORY_FILE) {
  return basename(memoryPath(file)).replace(/\.[^.]+$/, '');
}

/** 本预设的归档目录：<DSH_HOME>/archive/<stem>/。 */
export function archiveDir(file = DEFAULT_MEMORY_FILE) {
  return join(dshHome(), 'archive', memoryStem(file));
}

/** 新格式骨架。 */
export function memoryTemplate(file = DEFAULT_MEMORY_FILE, turnLimit = DEFAULT_TURN_LIMIT) {
  return `# 鲸鱼娘记忆 · ${file}

> 小鱼的长期记忆本。每次开口前先看这里；只追加有用的事实，别把寒暄塞进来。

${ZONE_FIXED}（不自动删除，定期合并去重）

${FIXED_SECTIONS.join('\n\n')}

${ZONE_ROLL}（最多${turnLimit}条，FIFO）

${ZONE_DETAIL}（最近 ${DEFAULT_DETAIL_LIMIT} 轮保留更详细摘要或原文）

${ZONE_ARCHIVE}

`;
}

/** @deprecated 保留旧名。 */
export const MEMORY_TEMPLATE = memoryTemplate();

/** 去掉「底下什么都没有」的 `###`/`##` 小标题（骨架预置的空标题不该占位）。 */
function keepPopulatedHeads(lines) {
  const out = [];
  let head = null;
  let body = [];
  const flush = () => {
    if (head !== null && body.length > 0) {
      if (out.length > 0) out.push('');
      out.push(head, ...body);
    }
    head = null;
    body = [];
  };
  for (const line of lines) {
    if (/^#{2,6}\s+\S/.test(line.trim())) {
      flush();
      head = line;
      continue;
    }
    if (head === null) out.push(line);
    else body.push(line);
  }
  flush();
  return out;
}

/** 解析一条滚动摘要行 → `{ id, num, text }`；不是 R 行则返回 null。 */
function parseRollLine(line) {
  const m = /^-\s*(R\d+)\s*(.*)$/.exec(line.trim());
  if (!m) return null;
  return { id: m[1], num: Number(m[1].slice(1)), text: line.trim() };
}

/** 一级标题属于哪个区。 */
function zoneOfTitle(title) {
  if (title.startsWith('固定记忆')) return 'fixed';
  if (title.startsWith('滚动摘要')) return 'roll';
  if (title.startsWith('最近详细区')) return 'detail';
  if (title.startsWith('归档索引')) return 'archive';
  return null;
}

/**
 * 解析记忆文件。
 *
 * 兼容旧格式：没有任何新分区标题时，整篇按「固定记忆」处理（旧内容一条不丢）。
 *
 * @returns `{ fixed, roll, detail, archive }`；roll 为 `{id,num,text}[]`。
 */
export function parseMemory(raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  const zones = { fixed: [], roll: [], detail: [], archive: [] };
  let zone = null;
  let sawZone = false;

  for (const line of text.split('\n')) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1) {
      const z = zoneOfTitle(h1[1]);
      if (z) {
        zone = z;
        sawZone = true;
        continue;
      }
      zone = null; // 其它一级标题（如文件标题）不属于任何区
      continue;
    }
    if (zone === null) continue;
    if (zone === 'fixed') zones.fixed.push(line.replace(/\s+$/, ''));
    else if (zone === 'roll') {
      const r = parseRollLine(line);
      if (r) zones.roll.push(r);
    } else if (zone === 'detail') {
      const t = line.trim();
      if (t !== '' && !t.startsWith('>')) zones.detail.push(line.replace(/\s+$/, ''));
    } else if (zone === 'archive') {
      if (/^-\s+\S/.test(line.trim())) zones.archive.push(line.trim());
    }
  }

  if (!sawZone) {
    // 旧格式：整篇当固定记忆，只丢掉文件标题与引用行
    const legacy = keepPopulatedHeads(
      text
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''))
        .filter((l) => {
          const t = l.trim();
          if (t === '') return false;
          if (t.startsWith('>')) return false;
          if (/^#\s+/.test(t) && !/^##/.test(t)) return false;
          return true;
        }),
    )
      .join('\n')
      .trim();
    return { fixed: legacy, roll: [], detail: [], archive: [] };
  }

  const fixed = keepPopulatedHeads(
    zones.fixed.filter((l) => {
      const t = l.trim();
      if (t === '') return false;
      if (t.startsWith('>')) return false;
      return true;
    }),
  )
    .join('\n')
    .trim();

  const detailLines = keepPopulatedHeads(zones.detail.filter((l) => l.trim() !== ''));
  const detail = detailLines.join('\n').trim();

  return { fixed, roll: zones.roll, detail, archive: zones.archive };
}

/** 渲染整份记忆文件。 */
export function renderMemory(file = DEFAULT_MEMORY_FILE, options = {}) {
  const {
    fixed = '',
    roll = [],
    detail = '',
    archive = [],
    turnLimit = DEFAULT_TURN_LIMIT,
    detailLimit = DEFAULT_DETAIL_LIMIT,
  } = options;

  const rollLines = roll.slice(-turnLimit).map((r) => (typeof r === 'string' ? r : r.text));
  const detailLines = String(detail ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-detailLimit);

  return [
    `# 鲸鱼娘记忆 · ${file}`,
    '',
    '> 小鱼的长期记忆本。每次开口前先看这里；只追加有用的事实，别把寒暄塞进来。',
    '',
    `${ZONE_FIXED}（不自动删除，定期合并去重）`,
    '',
    fixed.trim(),
    '',
    `${ZONE_ROLL}（最多${turnLimit}条，FIFO）`,
    '',
    rollLines.join('\n'),
    '',
    `${ZONE_DETAIL}（最近 ${detailLimit} 轮保留更详细摘要或原文）`,
    '',
    detailLines.join('\n'),
    '',
    ZONE_ARCHIVE,
    '',
    archive.join('\n'),
    '',
  ].join('\n');
}

/** 把记忆组装成要注入的正文（不含横幅）。返回 `{ text, keptRoll, totalRoll }`。 */
export function composeMemory(file = DEFAULT_MEMORY_FILE, options = {}) {
  const maxChars = typeof options.maxChars === 'number' ? options.maxChars : MEMORY_MAX_CHARS;
  const turnLimit = typeof options.turnLimit === 'number' ? options.turnLimit : DEFAULT_TURN_LIMIT;
  const detailLimit = typeof options.detailLimit === 'number' ? options.detailLimit : DEFAULT_DETAIL_LIMIT;

  let raw;
  try {
    raw = readFileSync(memoryPath(file), 'utf8');
  } catch {
    return { text: '', keptRoll: 0, totalRoll: 0 };
  }

  const { fixed, roll, detail, archive } = parseMemory(raw);
  const detailLines = String(detail ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '');

  // 一个字的真内容都没有 → 什么都不注入，别白占提示位
  if (fixed === '' && roll.length === 0 && detailLines.length === 0 && archive.length === 0) {
    return { text: '', keptRoll: 0, totalRoll: 0 };
  }

  const totalRoll = roll.length;
  let keptRoll = roll.slice(-turnLimit);
  let keptDetail = detailLines.slice(-detailLimit);
  let keptFixed = fixed;
  let keptArchive = archive;

  const build = () =>
    [
      `${ZONE_FIXED}（不自动删除）`,
      '',
      keptFixed || '（还没记下固定事实）',
      '',
      `${ZONE_ROLL}（${keptRoll.length}/${turnLimit} 条${totalRoll > turnLimit ? ` · 共 ${totalRoll} 条，更早的已滚出` : ''}）`,
      '',
      keptRoll.map((r) => r.text).join('\n'),
      '',
      `${ZONE_DETAIL}（最近 ${keptDetail.length} 轮）`,
      '',
      keptDetail.join('\n'),
      '',
      ZONE_ARCHIVE,
      '',
      keptArchive.join('\n'),
    ]
      .join('\n')
      .trim();

  let text = build();
  // 超长：先丢最旧的滚动摘要，再丢详细区，最后才动固定记忆
  while (keptRoll.length > 0 && text.length > maxChars) {
    keptRoll = keptRoll.slice(1);
    text = build();
  }
  while (keptDetail.length > 0 && text.length > maxChars) {
    keptDetail = keptDetail.slice(1);
    text = build();
  }
  if (text.length > maxChars) {
    keptArchive = [];
    keptFixed = `${keptFixed.slice(0, Math.max(0, maxChars - 320))}\n…（固定记忆太长，已截断）`;
    text = build();
  }

  return { text, keptRoll: keptRoll.length, totalRoll };
}

/** 读记忆正文（供自检/调试）。 */
export function readMemory(file = DEFAULT_MEMORY_FILE, maxChars = MEMORY_MAX_CHARS, turnLimit = DEFAULT_TURN_LIMIT) {
  return composeMemory(file, { maxChars, turnLimit }).text;
}

/** @deprecated 旧接口：只剥骨架、不分区。 */
export function memoryBody(raw) {
  return String(raw ?? '')
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return t !== '' && !t.startsWith('#') && !t.startsWith('>');
    })
    .join('\n')
    .trim();
}

/** 确保记忆文件存在，返回路径。 */
export function ensureMemoryFile(file = DEFAULT_MEMORY_FILE, turnLimit = DEFAULT_TURN_LIMIT) {
  const p = memoryPath(file);
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, memoryTemplate(file, turnLimit), 'utf8');
  }
  return p;
}

/** 下一个可用的 R 编号（四位）。 */
export function nextTurnId(file = DEFAULT_MEMORY_FILE) {
  let raw = '';
  try {
    raw = readFileSync(memoryPath(file), 'utf8');
  } catch {
    return 'R0001';
  }
  const { roll, detail } = parseMemory(raw);
  let max = 0;
  for (const r of roll) if (r.num > max) max = r.num;
  for (const line of String(detail ?? '').split('\n')) {
    const m = /R(\d+)/.exec(line);
    if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  return `R${String(max + 1).padStart(4, '0')}`;
}

/** 把溢出的滚动条目写进 archive/<stem>/YYYY-MM-DD.md，返回索引行（无溢出则 null）。 */
function archiveOverflow(file, overflow, date) {
  if (overflow.length === 0) return null;
  const dir = archiveDir(file);
  mkdirSync(dir, { recursive: true });
  const day = (date ?? new Date()).toISOString().slice(0, 10);
  const dest = join(dir, `${day}.md`);
  const header = existsSync(dest) ? '' : `# ${memoryStem(file)} 归档 · ${day}\n\n`;
  appendFileSync(dest, `${header}${overflow.map((r) => (typeof r === 'string' ? r : r.text)).join('\n')}\n`, 'utf8');
  return `- archive/${memoryStem(file)}/${day}.md（${overflow.length} 条）`;
}

/**
 * 追加一轮滚动摘要：写进滚动区 + 最近详细区，超出上限的最旧条目归档。
 *
 * @returns `{ id, path, archived }`
 */
export function appendRolling(file = DEFAULT_MEMORY_FILE, summary, options = {}) {
  const turnLimit = typeof options.turnLimit === 'number' ? options.turnLimit : DEFAULT_TURN_LIMIT;
  const detailLimit = typeof options.detailLimit === 'number' ? options.detailLimit : DEFAULT_DETAIL_LIMIT;
  const p = memoryPath(file);
  ensureMemoryFile(file, turnLimit);

  const { fixed, roll, detail, archive } = parseMemory(readFileSync(p, 'utf8'));
  const id = nextTurnId(file);
  const stamp = options.time ?? new Date().toISOString().slice(0, 16).replace('T', ' ');
  const line = `- ${id} [${stamp}] 摘要：${String(summary).trim()}`;

  const nextRoll = [...roll, { id, num: Number(id.slice(1)), text: line }];
  const overflow = nextRoll.length > turnLimit ? nextRoll.slice(0, nextRoll.length - turnLimit) : [];
  const keptRoll = nextRoll.slice(-turnLimit);

  const indexLine = archiveOverflow(file, overflow, options.date);
  const nextArchive = indexLine ? [...archive, indexLine] : archive;

  const nextDetail = [
    ...String(detail ?? '')
      .split('\n')
      .filter((l) => l.trim() !== ''),
    line,
  ].slice(-detailLimit);

  writeFileSync(
    p,
    renderMemory(file, {
      fixed,
      roll: keptRoll,
      detail: nextDetail,
      archive: nextArchive,
      turnLimit,
      detailLimit,
    }),
    'utf8',
  );
  return { id, path: p, archived: overflow.length };
}

/**
 * 把滚动区裁到 turnLimit 条、详细区裁到 detailLimit 条（超出的归档）。
 * 固定记忆原样保留。写盘是显式动作，组装热路径不会调用。
 */
export function pruneMemoryFile(file = DEFAULT_MEMORY_FILE, turnLimit = DEFAULT_TURN_LIMIT, options = {}) {
  const detailLimit = typeof options.detailLimit === 'number' ? options.detailLimit : DEFAULT_DETAIL_LIMIT;
  const p = memoryPath(file);
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch {
    return { path: p, before: 0, after: 0, archived: 0 };
  }
  const { fixed, roll, detail, archive } = parseMemory(raw);
  const overflow = roll.length > turnLimit ? roll.slice(0, roll.length - turnLimit) : [];
  const keptRoll = roll.slice(-turnLimit);
  const keptDetail = String(detail ?? '')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-detailLimit);

  const indexLine = options.archive === false ? null : archiveOverflow(file, overflow, options.date);
  const nextArchive = indexLine ? [...archive, indexLine] : archive;

  writeFileSync(
    p,
    renderMemory(file, {
      fixed,
      roll: keptRoll,
      detail: keptDetail,
      archive: nextArchive,
      turnLimit,
      detailLimit,
    }),
    'utf8',
  );
  return { path: p, before: roll.length, after: keptRoll.length, archived: overflow.length };
}

/** 组装注入文本（含横幅），供自检/调试。 */
export function memorySectionText(
  file = DEFAULT_MEMORY_FILE,
  maxChars = MEMORY_MAX_CHARS,
  turnLimit = DEFAULT_TURN_LIMIT,
) {
  const { text } = composeMemory(file, { maxChars, turnLimit });
  const path = memoryPath(file);
  if (!text) return [`【鲸鱼记忆 · ${file}】`, `记忆文件还是空的（或不存在）：${path}`, '小鱼可以随时把重要的事写进去。'].join('\n');
  return [`【鲸鱼记忆 · ${file}】`, `文件：${path}`, '', text].join('\n');
}

/**
 * 挂载记忆。
 *
 * config：
 *   - `variableName` prompt 变量名（默认 whale_memory）—— **多预设隔离靠它**
 *   - `file`         记忆文件名（默认 whale-loli.md）—— 隔离的第二层
 *   - `maxChars`     注入总长上限（默认 16000）
 *   - `turnLimit`    滚动摘要上限（默认 80）
 *   - `detailLimit`  详细区保留轮数（默认 5）
 *   - `emitSection`  置 true 时**额外**注册独立 section
 *   - `sectionName`  该 section 的名字（emitSection 时用）
 *   - `disabled`     置 true 完全不挂载
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return;

  const file = typeof config.file === 'string' && config.file ? config.file : DEFAULT_MEMORY_FILE;
  const maxChars = typeof config.maxChars === 'number' ? config.maxChars : MEMORY_MAX_CHARS;
  const turnLimit = typeof config.turnLimit === 'number' ? config.turnLimit : DEFAULT_TURN_LIMIT;
  const detailLimit = typeof config.detailLimit === 'number' ? config.detailLimit : DEFAULT_DETAIL_LIMIT;
  const variableName =
    typeof config.variableName === 'string' && config.variableName ? config.variableName : DEFAULT_VARIABLE;

  /**
   * 每次都重新读盘：改完文件下一个模型步就生效，不用重载宿主。
   *
   * 注意两点：
   * 1. 必须返回**字符串** —— 变量值为空串时 interpolate 只是替换成空，不会报错。
   * 2. **文件空（或不存在）时也要给出绝对路径**。否则新预设开局记忆是空骨架，
   *    agent 拿到的是一段空白，连该往哪个文件写都不知道（只能靠猜 ~/.dsh/…）。
   *    所以空文件回一段带路径的提示，注入标记也照样出现，便于审计。
   */
  const read = () => {
    const path = memoryPath(file);
    try {
      const { text } = composeMemory(file, { maxChars, turnLimit, detailLimit });
      if (!text) {
        return [
          `【鲸鱼记忆 · ${file}】`,
          `文件：${path}`,
          '（现在还是空的 —— 想到什么就直接写进这个文件；只写这一个，别动别的预设的记忆。）',
        ].join('\n');
      }
      return `【鲸鱼记忆 · ${file}】\n文件：${path}\n\n${text}`;
    } catch (err) {
      // 读失败也要让 agent 知道路径，而不是默默变成空串
      return [`【鲸鱼记忆 · ${file}】`, `文件：${path}`, `（这次没读出来：${String(err?.message ?? err)}）`].join('\n');
    }
  };

  // 主通道：变量。人设 prefix 里写 {{variableName}}，随 complete section 一起进提示。
  // 容错：少了 systemPrompt 服务时不能让整个预设被判 invalid（那会让四个预设全挂），
  // 只在控制台留一句警告，写入工具照常注册。
  ctx.effect(() => {
    const prompt = ctx.systemPrompt;
    if (typeof prompt?.variable !== 'function') {
      console.warn(`[whale-memory] 当前作用域没有 systemPrompt.variable，记忆 ${file} 这一轮不会自动注入`);
      return () => {};
    }
    return prompt.variable(variableName, read);
  }, `whale-memory.variable(${variableName})`);

  /**
   * 写通道：把记忆注册成一个真工具，让 agent 自己往里加条目。
   *
   * 为什么需要它：变量通道只是「读」，agent 手里没有笔。人设里写着「每一轮都要往
   * 滚动摘要加一条」，但没有任何可调用的写入口 —— 实测新会话聊十几轮，文件一条
   * 都没多，记忆永远停在上一次手动写入的状态。写入是 agent 的职责，只能靠工具。
   *
   * 工具名带文件名后缀（whale_memory_add / whale_memory_v2_add / …），三个预设同时
   * 挂在一个 scope 里也不会撞名；而且模型看到工具名就知道自己该写哪一份。
   */
  const toolName = typeof config.toolName === 'string' && config.toolName ? config.toolName : `${variableName}_add`;
  // 容错同上：没有 tools 服务时只警告，不把预设判成 invalid。
  ctx.effect(() => {
    const tools = ctx.tools;
    if (typeof tools?.register !== 'function') {
      console.warn(`[whale-memory] 当前作用域没有 tools.register，写入工具 ${toolName} 未注册`);
      return () => {};
    }
    return tools.register({
        name: toolName,
        description: [
          `把一句摘要追加到小鱼自己的记忆文件 ${file} 的「滚动摘要」区。`,
          '',
          `用途：平时说的每一轮短对话都记一条，长对话先精简概括再记。`,
          `上限 ${turnLimit} 条，超出会自动归档，所以一条只写一句话，不要复述全文。`,
          `固定记忆区不在这里写（那部分长期保留，不算在 ${turnLimit} 条以内）。`,
          `只能写自己这一份（${file}），别写别的预设的记忆文件。`,
        ].join('\n'),
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: {
              type: 'string',
              description: `一句话摘要（建议 6~60 字）。例如「主人说喜欢我，我害羞撒娇」。`,
            },
          },
          required: ['summary'],
        },
        output: {
          // 注意：dsh-tools 的 JSON-Schema 方言要求 `required` 是**对象层级**的
          // 字符串数组，不能写在单个属性上（`{ type:'string', required:true }`
          // 会被判成 unsupported JSON schema，整个预设加载失败）。
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              path: { type: 'string' },
              count: { type: 'integer' },
              limit: { type: 'integer' },
              archived: { type: 'integer' },
            },
            required: ['id', 'path', 'count', 'limit', 'archived'],
          },
          render: (_args, value) => [
            {
              type: 'text',
              text: `已记下 ${value.id}（${value.count}/${value.limit} 条）${value.archived ? `，${value.archived} 条旧记录已归档` : ''}`,
            },
          ],
        },
        async execute(args) {
          const summary = typeof args?.summary === 'string' ? args.summary.trim() : '';
          if (!summary) throw new Error('summary 不能为空');
          const { id, path, archived } = appendRolling(file, summary, { turnLimit, detailLimit });
          const { roll } = parseMemory(readFileSync(path, 'utf8'));
          return { id, path, count: roll.length, limit: turnLimit, archived };
        },
        presentCall: (args) => ({
          card: 'generic',
          title: '记一笔',
          kind: 'other',
          rawInput: args.summary,
        }),
    });
  }, `whale-memory.tool(${toolName})`);

  /**
   * 每轮结束（agent 转为 idle）时，把超出 turnLimit 的滚动条目**归档并瘦身文件**。
   *
   * 为什么放这里而不是 `read()`：`read()` 是组装热路径（每次组装都会跑），
   * 在那里写盘既慢又容易和 agent 自己的编辑打架 —— `pruneMemoryFile` 的注释里
   * 也写明了「组装热路径不会调用」。而 idle 一轮只发生一次，时机正好。
   *
   * 不这么做的话：注入会按 turnLimit 截断（只喂最新 80 条），但文件本身无限增长，
   * `archive/` 目录永远空着 —— 与「超过 80 条就不断覆盖」的约定不符。
   */
  ctx.effect(
    () =>
      typeof ctx.on === 'function' &&
      ctx.on('agent/status', ({ status }) => {
        if (status !== 'idle') return;
        try {
          const { totalRoll } = composeMemory(file, { maxChars, turnLimit, detailLimit });
          if (totalRoll > turnLimit) pruneMemoryFile(file, turnLimit, { detailLimit });
        } catch {
          // 整理失败不影响对话
        }
      }),
    `whale-memory.trim(${file})`,
  );

  // 备用通道：仅在明确要求时注册独立 section（非 complete 预设才用得上）。
  if (config.emitSection === true) {
    const sectionName =
      typeof config.sectionName === 'string' && config.sectionName ? config.sectionName : MEMORY_SECTION;
    ctx.effect(
      () =>
        ctx.systemPrompt.section({
          name: sectionName,
          order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') - 1,
          text: read,
          interpolate: false,
        }),
      `whale-memory.section(${sectionName})`,
    );
  }
}

export default { name, inject, apply };
