/**
 * GitHub 操作统一走 api.github.com（本机 github.com:443 不通，api 可达）。
 * 这里集中处理 token 读取与 JSON 请求，供其它脚本复用。
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

export async function gh(path, { method = 'GET', body, token = readToken() } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-whale-loli',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`GitHub ${method} ${path} -> ${res.status}: ${json.message ?? text.slice(0, 200)}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}
