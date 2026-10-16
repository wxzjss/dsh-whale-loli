/**
 * GitHub 操作统一走 api.github.com（本机 github.com:443 不通，api 可达）。
 *
 * 导出 glab（原 gh）：带重试 / 速率限制处理 / utf8-safe base64 的封装。
 */
import { readFileSync } from 'node:fs';

const TOKEN_PATHS = [
  'C:/Users/35453/Downloads/ghp.txt',
  'C:/Users/35453/Downloads/ghp.txt.txt',
];

export function readToken() {
  for (const p of TOKEN_PATHS) {
    try {
      const t = readFileSync(p, 'utf8').trim();
      if (t) return t;
    } catch { /* 试下一个 */ }
  }
  return process.env.GH_TOKEN?.trim() ?? '';
}

/** utf8 -> base64（GitHub Contents API 要求的形态）。 */
export function b64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** 下载到的 base64 -> utf8 字符串。 */
export function unb64(content) {
  return Buffer.from(content, 'base64').toString('utf8');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 调 GitHub REST。5xx / 网络抖动重试 3 次；403+剩余配额 0 时按重置时间等待。
 */
export async function glab(path, { method = 'GET', body, token = readToken(), retries = 3 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, {
        method,
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'dsh-whale-loli',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      lastErr = e;
      if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error(`GitHub ${method} ${path} 网络失败: ${e.message}`);
    }

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (res.ok) return json;
    if (res.status === 404) {
      const err = new Error(`GitHub ${method} ${path} -> 404`);
      err.status = 404;
      throw err;
    }
    // 配额耗尽：等到重置
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = Number(res.headers.get('x-ratelimit-reset') ?? 0);
    if ((res.status === 403 || res.status === 429) && remaining === '0' && reset) {
      const waitMs = Math.max(1000, reset * 1000 - Date.now() + 1500);
      if (waitMs < 3600_000 && attempt < retries) {
        console.log(`  · 触到 GitHub 速率限制，等 ${Math.ceil(waitMs / 1000)}s 后重试`);
        await sleep(waitMs);
        continue;
      }
    }
    if (res.status >= 500 && attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }

    const err = new Error(`GitHub ${method} ${path} -> ${res.status}: ${json.message ?? text.slice(0, 200)}`);
    err.status = res.status;
    err.payload = json;
    lastErr = err;
    throw err;
  }
  throw lastErr;
}
