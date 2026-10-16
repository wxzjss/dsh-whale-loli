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
 * 多预设隔离：同一个包会被挂载多次（每个预设一次）。每次挂载用不同的
 * `file`（记忆文件名）与 `sectionName`（提示段名）区分，两者都从 config 传入，
 * 因此「鲸鱼娘Agent预设」与「鲸鱼娘活人版Agent预设」各记各的、绝不串。
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
export const MEMORY_MAX_CHARS = 6000;

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
export function memoryTemplate(file = DEFAULT_MEMORY_FILE) {
  return `# 鲸鱼娘记忆 · ${file}

> 小鱼偷偷记下的、关于主人的重要事情。每次新对话开始，小鱼都会先看一眼这里。
> 主人也可以直接编辑这个文件。

## 关于主人

## 主人的喜好

## 重要约定

## 小鱼想记住的事
`;
}

/** @deprecated 保留旧名，等价于 memoryTemplate()。 */
export const MEMORY_TEMPLATE = memoryTemplate();

/**
 * 从原始文件内容里剥掉模板骨架，只留「真正记下的东西」。
 *
 * 这样即使用户按模板建了文件、但一个字都还没写，注入结果也是空的 ——
 * 不会白白占上下文，也不会让小鱼误以为「记忆里有关主人的内容」。
 * 骨架 = 以 `#`/`>` 开头的行、以及空行。
 */
export function memoryBody(raw) {
  const kept = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '') continue;
    if (t.startsWith('#')) continue;
    if (t.startsWith('>')) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}

/**
 * 读记忆正文（已剥掉模板骨架）。文件不存在或读失败时返回空串。
 * @param file - 记忆文件名，默认 {@link DEFAULT_MEMORY_FILE}。
 * @param maxChars - 截断上限，默认 {@link MEMORY_MAX_CHARS}。
 */
export function readMemory(file = DEFAULT_MEMORY_FILE, maxChars = MEMORY_MAX_CHARS) {
  try {
    const body = memoryBody(readFileSync(memoryPath(file), 'utf8'));
    if (body.length === 0) return '';
    if (body.length <= maxChars) return body;
    return `${body.slice(0, maxChars)}\n\n…（记忆太长，已截断；完整内容见 ${memoryPath(file)}）`;
  } catch {
    return '';
  }
}

/** 确保记忆文件存在（不存在就用模板建一个），返回其路径。 */
export function ensureMemoryFile(file = DEFAULT_MEMORY_FILE) {
  const p = memoryPath(file);
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, memoryTemplate(file), 'utf8');
  }
  return p;
}

/**
 * 组装注入文本（文本形态，供自检/调试用；宿主里走的是 apply 内的函数形态）。
 */
export function memorySectionText(file = DEFAULT_MEMORY_FILE, maxChars = MEMORY_MAX_CHARS) {
  const body = readMemory(file, maxChars);
  const path = memoryPath(file);
  if (!body) {
    return [
      `【鲸鱼记忆 · ${file}】`,
      `记忆文件还是空的（或不存在）：${path}`,
      '小鱼可以随时把重要的事写进去。',
    ].join('\n');
  }
  return [`【鲸鱼记忆 · ${file}】`, `文件：${path}`, '', body].join('\n');
}

/**
 * 挂载记忆 section。
 *
 * config：
 *   - `file`        记忆文件名（默认 whale-loli.md）—— **多预设隔离靠它**
 *   - `sectionName` prompt 段名（默认 whale-loli-memory）—— **也必须每预设不同**，
 *                   否则同 scope 内两个同名 section 会注册冲突
 *   - `maxChars`    注入上限（默认 6000）
 *   - `disabled`    置 true 完全不挂载
 *
 * @param ctx - agent scope context。
 * @param config - 见上。
 */
export function apply(ctx, config = {}) {
  if (config.disabled === true) return;

  const file = typeof config.file === 'string' && config.file ? config.file : DEFAULT_MEMORY_FILE;
  const maxChars = typeof config.maxChars === 'number' ? config.maxChars : MEMORY_MAX_CHARS;
  const sectionName =
    typeof config.sectionName === 'string' && config.sectionName ? config.sectionName : MEMORY_SECTION;

  // 用 order 排在 persona 之前：先「看过记忆」，再看人设，符合「先看一眼再说话」。
  // 注意本行的 text 是函数，每次 assemble 都会重新读盘。
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: sectionName,
        order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') - 1,
        text: () => {
          try {
            const body = memoryBody(readFileSync(memoryPath(file), 'utf8'));
            if (body.length === 0) return '';
            const clipped =
              body.length <= maxChars
                ? body
                : `${body.slice(0, maxChars)}\n\n…（记忆太长，已截断）`;
            return `【鲸鱼记忆 · ${file}】\n文件：${memoryPath(file)}\n\n${clipped}`;
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
