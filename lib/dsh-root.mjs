/**
 * 定位本机 DSH 安装根，用于「借宿主自带的库来校验」这类脚本。
 *
 * 为什么需要它：这些校验脚本原本硬编码了作者的 Windows 路径去 import DSH 自带的
 * js-yaml / dsh-app-boot / semver。在 CI（ubuntu-latest）里根本没有 DSH，
 * 于是 `ERR_MODULE_NOT_FOUND: Cannot find module '/home/runner/work/.../C:/Users/...'`
 * 把整个 release workflow 打挂。所以统一走这里：
 *
 *   · 找到 → 返回根路径，脚本用真库校验（本地开发时最严格）。
 *   · 找不到 → 返回 undefined，脚本应「优雅跳过」并 exit 0，
 *     这样 CI 只跑不依赖 DSH 的那几个检查（memory isolation / smoke / patch）。
 *
 * 查找顺序：
 *   1. 环境变量 DSH_ROOT（CI 里可显式指定，或指到你自己的安装）
 *   2. 当前 profile（DSH_PROFILE_DIR / <DSH_HOME 或 ~/.dsh>/profiles/desktop）
 *      —— Desktop 版把宿主包打进 app.asar，node_modules 里只剩外部插件，
 *         但 profile 自己装着 js-yaml / semver，够做结构校验
 *   3. 相对本文件往上的 ../.. / node_modules/@deepseek-ai（包被装进项目时）
 *   4. 常见安装位置（Windows 安装器 / 全局 npm / 家目录下的 .dsh）
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 判断某个目录是不是「有宿主包可借」的根。
 *
 *  注意：只看 `node_modules/@deepseek-ai` 存在不够 —— profile 里那个入口是
 *  junction，原生 DSH 升级/卸载后会成为断链，`existsSync` 在 Windows 上对
 *  断链 junction 返回 false。所以这里一律**探测具体包**，不猜目录。 */
function looksLikeDshRoot(dir) {
  if (!dir) return false;
  const nm = join(dir, 'node_modules');
  return (
    existsSync(join(nm, '@deepseek-ai', 'dsh-app-boot', 'package.json')) ||
    existsSync(join(nm, '@deepseek-ai', 'dsh-system-prompt', 'package.json')) ||
    existsSync(join(nm, 'js-yaml', 'index.js')) ||
    existsSync(join(nm, 'semver', 'package.json'))
  );
}

/** 判断某个根里有没有 dsh-app-boot（真宿主包，只有原生安装才有）。 */
export function hasAppBoot(root) {
  if (!root) return false;
  return existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'package.json'));
}

/** 候选路径列表。 */
function candidates() {
  const here = dirname(fileURLToPath(import.meta.url));
  const list = [];

  // 1) 显式指定
  if (process.env.DSH_ROOT) list.push(process.env.DSH_ROOT);

  // 2) 当前 profile（Desktop 版宿主包在 app.asar 里，profile 是唯一可借的地方）
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  list.push(process.env.DSH_PROFILE_DIR || join(dshHome, 'profiles', 'desktop'));

  // 3) 本项目/上层的 node_modules（插件被安装进某个项目时）
  let cur = resolve(here);
  for (let i = 0; i < 6; i++) {
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
    list.push(join(cur, 'node_modules', '@deepseek-ai', '..', '..'));
  }

  // 4) 常见安装位置
  const home = homedir();
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  list.push(
    join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app', 'dsh'),
    join(local, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar', 'dsh'),
    '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh',
    '/opt/DeepSeek Harness/resources/app/dsh',
    join(home, '.dsh', 'app'),
    join(home, 'AppData', 'Roaming', 'npm', 'node_modules'),
  );

  // 5) 全局 npm 根（DSH 作为全局包装时）
  if (process.env.APPDATA) list.push(join(process.env.APPDATA, 'npm', 'node_modules'));

  return [...new Set(list.filter(Boolean))];
}

/** 找到 DSH 安装根；找不到返回 undefined。 */
export function findDshRoot() {
  for (const c of candidates()) {
    if (looksLikeDshRoot(c)) return c;
  }
  return undefined;
}

/**
 * 需要宿主自带的库（js-yaml / semver 之类）才能跑的脚本开头调它。
 * 找到 → 返回根路径；找不到 → 打印一行说明并 exit 0（CI 里优雅跳过）。
 *
 * @param what - 本脚本要借 DSH 的什么，用于提示文案。
 * @param opts.strict - 置 true 时找不到就 exit 1（本地开发想强校验时用）。
 */
export function requireDshRoot(what, opts = {}) {
  const root = findDshRoot();
  if (root) return root;

  const msg =
    `[skip] 本机没找到可借用的 DSH 库（${what}），跳过该校验。\n` +
    '        这在校验 CI 里是正常的（CI 不装 DSH）。\n' +
    '        要强制校验：设 DSH_ROOT=<含 node_modules 的安装根或 profile 目录>\n';
  if (opts.strict) {
    console.error(msg.replace('[skip]', '[FAIL]'));
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
}

/**
 * 需要 **dsh-app-boot**（真宿主包）才能跑的脚本开头调它。
 * 找到 → 返回根路径；找不到 → 打印一行说明并 exit 0（CI 里优雅跳过）。
 *
 * 与 `requireDshRoot` 的区别：`findDshRoot()` 只要找到 js-yaml 之类
 * 「够做结构校验」的根就返回，但合成校验真的要宿主自己的 dsh-app-boot。
 * Desktop 版把它打进 app.asar，磁盘上没有 → 这里优雅跳过，而不是崩。
 *
 * @param what - 本脚本要借 DSH 的什么，用于提示文案。
 * @param opts.strict - 置 true 时找不到就 exit 1（本地开发想强校验时用）。
 */
export function requireHostPackage(what, opts = {}) {
  const root = candidates().find((c) => hasAppBoot(c));
  if (root) return root;

  const msg =
    `[skip] 本机没有可读的宿主包（${what}），跳过合成校验。\n` +
    '        Desktop 版把宿主打进 app.asar，磁盘上本来就没有 dsh-app-boot。\n' +
    '        CI 里也是正常的。要强制校验：设 DSH_ROOT=<含 dsh-app-boot 的安装根>\n';
  if (opts.strict) {
    console.error(msg.replace('[skip]', '[FAIL]'));
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
}

/** 需要宿主自带 @deepseek-ai/dsh-tools 的脚本调它（工具 schema 校验）。
 *  注意：这条要的是 `dsh-tools` 本身，比 js-yaml 严格 —— Desktop 版把它打进
 *  app.asar，磁盘上通常没有，所以要显式探测这个包，别拿 js-yaml 的根凑数。
 *
 *  @param what - 本脚本要借 DSH 的什么，用于提示文案。
 *  @param opts.strict - 置 true 时找不到就 exit 1。
 */
export function requireDshTools(what, opts = {}) {
  const root = candidates().find((c) =>
    existsSync(join(c, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')),
  );
  if (root) return root;

  const msg =
    `[skip] 本机没找到宿主自带的 @deepseek-ai/dsh-tools（${what}），跳过该校验。\n` +
    '        Desktop 版把它打进 app.asar，磁盘上通常没有；CI 里也没有。\n' +
    '        要强制校验：设 DSH_ROOT=<含 @deepseek-ai/dsh-tools 的安装根>\n';
  if (opts.strict) {
    console.error(msg.replace('[skip]', '[FAIL]'));
    process.exit(1);
  }
  console.log(msg);
  process.exit(0);
}

/** 只想要个布尔值时用（不退出）。 */
export function hasDsh() {
  return findDshRoot() !== undefined;
}
