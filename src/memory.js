/**
 * whale-memory —— 鲸鱼娘的「长期记忆」记忆行。
 *
 * 作用：把某个记忆文件（默认 <DSH_HOME>/whale-loli.md）作为一条 prompt section
 * 注入到系统提示里。因为走的是 `section()` 而不是 `context()`，所以即使预设
 * 关掉了运行时上下文（includeRuntimeContext: false）也照样生效。
 *
 * text 传的是函数而不是字符串：`system-prompt` 会在**每次组装系统提示时**调用它
 * （lib/index.js 的 `typeof section.text === "function" ? section.text(context)`），
 * 所以文件被改后下一个模型步就生效，不用重载宿主。
 *
 * ── 记忆文件分成两个区 ────────────────────────────────────────────────
 *
 *   ## 重要记忆   永久保留。不管轮数多少、时间多久都不会被挤掉
 *                （只有总长度顶到 maxChars 兜底时才会截断）。
 *   ## 对话记录   滚动流水。每轮对话一条，只保留最近 turnLimit 轮，
 *                超出的从最旧的开始滚出去。
 *
 * 两道保险确保「80 轮上限」真的成立：
 *   1. 注入时按 turnLimit 只取最近 N 轮 —— 即使文件里堆了 500 轮，
 *      进到上下文里的也只有 80 轮。
 *   2. pruneMemoryFile() 可以把文件本身裁到 N 轮（写盘由调用方决定，
 *      不在组装热路径里偷偷写）。
 * 长度超 maxChars 时，先丢最旧的对话轮次，重要记忆最后才动。
 *
 * 多预设隔离：同一个包会被挂载多次（每个预设一次）。每次挂载用不同的
 * `file`（记忆文件名）与 `sectionName`（提示段名）区分，两者都从 config 传入，
 * 因此「鲸鱼娘Agent预设」「活人版」「涩涩版」各记各的、绝不串。
 *
 * 另外导出工具函数，供构建脚本与自检复用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Cordis 插件名（loader 诊断用）。 */
export const name = 'whale-memory';

/** 需要 prompt registry。 */
export const inject = ['systemPrompt'];

/** 默认记忆文件名（放在 <DSH_HOME> 下）。 */
export const DEFAULT_MEMORY_FILE = 'whale-loli.md';

/** 默认 section 名。 */
export const MEMORY_SECTION = 'whale-loli-memory';

/** 注入上限：记忆再长也不超过这么多字符，避免拖垮上下文。 */
export const MEMORY_MAX_CHARS = 16000;

/** 对话记录的滚动上限（轮）。重要记忆不占这个名额。 */
export const DEFAULT_TURN_LIMIT = 80;

/** 永久区标题。 */
export const ZONE_PERMANENT = '## 重要记忆';

/** 流水区标题。 */
export const ZONE_LOG = '## 对话记录';

/** DSH 家目录：DSH_HOME 环境变量优先，否则 ~/.dsh（与 core 的 findDshHome() 一致）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/**
 * 解析记忆文件路径。
 * @param file - 记忆文件名或绝对路径；默认 {@link DEFAULT_MEMORY_FILE}。
 *   相对文件名解析到 <DSH_HOME>/ 下；传绝对路径则原样使用。
 */
export function memoryPath(file = DEFAULT_MEMORY_FILE) {
  if (!file) return join(dshHome(), DEFAULT_MEMORY_FILE);
  // 绝对路径（Windows 盘符或 POSIX 根）直接用；否则挂到 DSH 家目录下。
  if (/^[a-zA-Z]:[\\/]/.test(file) || file.startsWith('/') || file.startsWith('\\')) {
    return file;
  }
  return join(dshHome(), file);
}

/** 记忆文件不存在时写入的初始骨架。 */
export function memoryTemplate(file = DEFAULT_MEMORY_FILE, turnLimit = DEFAULT_TURN_LIMIT) {
  return `# 鲸鱼娘记忆 · ${file}

> 小鱼偷偷记下的、关于主人的事情。每次新对话开始，小鱼都会先看一眼这里。
> 主人也可以直接编辑这个文件。

${ZONE_PERMANENT}

> 长期保留，永远不会被对话记录挤掉。只放以后还用得上的稳定事实和约定。

### 关于主人

### 主人的喜好

### 重要约定

${ZONE_LOG}

> 每轮对话都记一条：短对话直接记，长对话精简概括。只保留最近 ${turnLimit} 轮，
> 满了就从最旧的开始滚出去。值得长期留的挪到上面的「重要记忆」里，就不会被挤掉。
`;
}

/** @deprecated 保留旧名，等价于 memoryTemplate()。 */
export const MEMORY_TEMPLATE = memoryTemplate();

/** 这一行是不是分区标题（可能是带后缀变体，例如「## 对话记录（3/80 轮）」）。 */
function isZoneLine(t) {
  return (
    t === ZONE_PERMANENT ||
    t === ZONE_LOG ||
    t.startsWith(`${ZONE_PERMANENT} `) ||
    t.startsWith(`${ZONE_LOG} `)
  );
}

/**
 * 丢掉「底下什么都没有」的 `###` 小标题。
 *
 * 模板里预置了「关于主人 / 主人的喜好 / 重要约定」几个空标题；主人一个字都还没写时，
 * 把这些空标题注入进去纯属占位噪声（还会让小鱼以为「记忆里有关主人的内容」）。
 * 只要某个标题到下一个标题之间没有任何条目，就连标题一起去掉。
 */
function keepPopulatedHeads(lines) {
  const out = [];
  let pendingHead = null;
  let pendingBody = [];
  const flush = () => {
    if (pendingHead !== null && pendingBody.length > 0) {
      // 小标题前留一个空行，避免「### 标题」紧贴上一条内容。
      if (out.length > 0) out.push('');
      out.push(pendingHead, ...pendingBody);
    }
    pendingHead = null;
    pendingBody = [];
  };
  for (const line of lines) {
    if (/^#{2,6}\s+\S/.test(line.trim())) {
      flush();
      pendingHead = line;
      continue;
    }
    if (pendingHead === null) out.push(line);
    else pendingBody.push(line);
  }
  flush();
  return out;
}

/**
 * 把记忆文件解析成「永久区正文 + 对话轮次数组」。
 *
 * 兼容旧格式：没有 `## 对话记录` 的文件（老版本写的）整个当永久区，
 * 轮次为空 —— 老记忆一条不丢。
 *
 * 永久区保留 `###` 小标题与 `- ` 条目（结构对模型有用），
 * 只丢掉一级标题、`>` 引用行、空行和分区标题本身。
 */
export function parseMemory(raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');

  let head;
  let logZone;
  const nl = `\n${ZONE_LOG}`;
  const i = text.indexOf(nl);
  if (i !== -1) {
    head = text.slice(0, i);
    logZone = text.slice(i + 1);
  } else if (text.startsWith(ZONE_LOG)) {
    head = '';
    logZone = text;
  } else {
    head = text;
    logZone = '';
  }

  const permanent = keepPopulatedHeads(
    head
      .split('\n')
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => {
        const t = l.trim();
        if (t === '') return false;
        if (t.startsWith('>')) return false;
        if (t.startsWith('# ') || t === '#') return false;
        if (isZoneLine(t)) return false;
        return true;
      }),
  ).join('\n').trim();

  const turns = logZone
    .split('\n')
    .map((l) => l.trim())
    .filter((t) => t.startsWith('- '));

  return { permanent, turns };
}

/** 把「永久区 + 轮次」渲染回整份文件。 */
export function renderMemory(file = DEFAULT_MEMORY_FILE, options = {}) {
  const { permanent = '', turns = [], turnLimit = DEFAULT_TURN_LIMIT } = options;
  const body = [
    `# 鲸鱼娘记忆 · ${file}`,
    '',
    '> 小鱼偷偷记下的、关于主人的事情。每次新对话开始，小鱼都会先看一眼这里。',
    '> 主人也可以直接编辑这个文件。',
    '',
    ZONE_PERMANENT,
    '',
    '> 长期保留，永远不会被对话记录挤掉。只放以后还用得上的稳定事实和约定。',
    '',
    permanent.trim(),
    '',
    ZONE_LOG,
    '',
    `> 每轮对话都记一条：短对话直接记，长对话精简概括。只保留最近 ${turnLimit} 轮，`,
    '> 满了就从最旧的开始滚出去。值得长期留的挪到上面的「重要记忆」里，就不会被挤掉。',
    '',
    turns.join('\n'),
    '',
  ];
  return body.join('\n');
}

/**
 * 组装成要注入的正文（不含【鲸鱼记忆】横幅与文件路径，那两行由 apply 加）。
 *
 * @returns `{ text, totalTurns, keptTurns }`；文件不存在时 text 为空串。
 */
export function composeMemory(file = DEFAULT_MEMORY_FILE, options = {}) {
  const maxChars = typeof options.maxChars === 'number' ? options.maxChars : MEMORY_MAX_CHARS;
  const turnLimit = typeof options.turnLimit === 'number' ? options.turnLimit : DEFAULT_TURN_LIMIT;

  let raw;
  try {
    raw = readFileSync(memoryPath(file), 'utf8');
  } catch {
    return { text: '', totalTurns: 0, keptTurns: 0 };
  }

  const { permanent, turns } = parseMemory(raw);
  const totalTurns = turns.length;
  let kept = turns.slice(-turnLimit);
  let perm = permanent;

  // 一个字的真内容都没有（只有模板骨架）→ 什么都不注入，别白占提示位。
  if (perm === '' && totalTurns === 0) return { text: '', totalTurns: 0, keptTurns: 0 };

  const banner = (n) =>
    totalTurns > turnLimit
      ? `${ZONE_LOG}（最近 ${n} 轮 · 共 ${totalTurns} 轮，更早的已滚出）`
      : `${ZONE_LOG}（${n}/${turnLimit} 轮）`;

  const assemble = () => {
    const out = [ZONE_PERMANENT, ''];
    if (perm) out.push(perm, '');
    out.push(banner(kept.length));
    if (kept.length) out.push('', ...kept);
    return out.join('\n').trim();
  };

  let text = assemble();
  // 超长先丢最旧的对话轮次 —— 重要记忆优先于流水。
  while (kept.length > 0 && maxChars > 0 && text.length > maxChars) {
    kept = kept.slice(1);
    text = assemble();
  }
  // 实在还超，才动重要记忆（最后手段）。
  if (maxChars > 0 && text.length > maxChars) {
    perm = `${perm.slice(0, Math.max(0, maxChars - 220))}\n…（重要记忆太长，已截断）`;
    text = assemble();
  }

  return { text, totalTurns, keptTurns: kept.length };
}

/**
 * 读记忆正文（已剥掉模板骨架）。
 * @param file - 记忆文件名，默认 {@link DEFAULT_MEMORY_FILE}。
 * @param maxChars - 截断上限，默认 {@link MEMORY_MAX_CHARS}。
 * @param turnLimit - 对话记录最多注入多少轮，默认 {@link DEFAULT_TURN_LIMIT}。
 */
export function readMemory(file = DEFAULT_MEMORY_FILE, maxChars = MEMORY_MAX_CHARS, turnLimit = DEFAULT_TURN_LIMIT) {
  return composeMemory(file, { maxChars, turnLimit }).text;
}

/** @deprecated 旧接口：只剥骨架、不分区。保留以免旧脚本 import 报错。 */
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

/** 确保记忆文件存在（不存在就用模板建一个），返回其路径。 */
export function ensureMemoryFile(file = DEFAULT_MEMORY_FILE, turnLimit = DEFAULT_TURN_LIMIT) {
  const p = memoryPath(file);
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, memoryTemplate(file, turnLimit), 'utf8');
  }
  return p;
}

/**
 * 把文件里的对话记录裁到最近 `turnLimit` 轮，超出的从最旧开始删掉。
 *
 * 只重写「对话记录」的内容，永久区原样保留。写盘是显式动作 ——
 * 组装系统提示的热路径**不会**偷偷写文件。
 *
 * @returns `{ path, before, after, pruned }`。
 */
export function pruneMemoryFile(file = DEFAULT_MEMORY_FILE, turnLimit = DEFAULT_TURN_LIMIT) {
  const p = memoryPath(file);
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch {
    return { path: p, before: 0, after: 0, pruned: 0 };
  }
  const { permanent, turns } = parseMemory(raw);
  if (turns.length <= turnLimit) {
    return { path: p, before: turns.length, after: turns.length, pruned: 0 };
  }
  const kept = turns.slice(-turnLimit);
  writeFileSync(p, renderMemory(file, { permanent, turns: kept, turnLimit }), 'utf8');
  return { path: p, before: turns.length, after: kept.length, pruned: turns.length - kept.length };
}

/**
 * 组装注入文本（文本形态，供自检/调试用；宿主里走的是 apply 内的函数形态）。
 */
export function memorySectionText(
  file = DEFAULT_MEMORY_FILE,
  maxChars = MEMORY_MAX_CHARS,
  turnLimit = DEFAULT_TURN_LIMIT,
) {
  const { text } = composeMemory(file, { maxChars, turnLimit });
  const path = memoryPath(file);
  if (!text) {
    return [`【鲸鱼记忆 · ${file}】`, `记忆文件还是空的（或不存在）：${path}`, '小鱼可以随时把重要的事写进去。'].join('\n');
  }
  return [`【鲸鱼记忆 · ${file}】`, `文件：${path}`, '', text].join('\n');
}

/**
 * 挂载记忆 section。
 *
 * config：
 *   - `file`        记忆文件名（默认 whale-loli.md）—— **多预设隔离靠它**
 *   - `sectionName` prompt 段名（默认 whale-loli-memory）—— **也必须每预设不同**，
 *                   否则同 scope 内两个同名 section 会注册冲突
 *   - `maxChars`    注入总长上限（默认 16000）
 *   - `turnLimit`   对话记录最多注入多少轮（默认 80）
 *   - `disabled`    置 true 完全不挂载
 *
 * @param ctx - agent scope context。
 * @param config - 见上。
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return;

  const file = typeof config.file === 'string' && config.file ? config.file : DEFAULT_MEMORY_FILE;
  const maxChars = typeof config.maxChars === 'number' ? config.maxChars : MEMORY_MAX_CHARS;
  const turnLimit = typeof config.turnLimit === 'number' ? config.turnLimit : DEFAULT_TURN_LIMIT;
  const sectionName =
    typeof config.sectionName === 'string' && config.sectionName ? config.sectionName : MEMORY_SECTION;

  // 用 order 排在 persona 之前：先「看过记忆」，再看人设，符合「先看一眼再说话」。
  // 注意本行的 text 是函数，每次 assemble 都会重新读盘（并且只取最近 turnLimit 轮）。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: sectionName,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') - 1,
        text: () => {
          try {
            const { text } = composeMemory(file, { maxChars, turnLimit });
            if (!text) return '';
            return `【鲸鱼记忆 · ${file}】\n文件：${memoryPath(file)}\n\n${text}`;
          } catch {
            // 文件还没建：不报错，也不占用提示位。
            return '';
          }
        },
        interpolate: false,
      }),
    `whale-memory.section(${sectionName})`,
  );
}

export default { name, inject, apply };
