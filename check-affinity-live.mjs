#!/usr/bin/env node
/**
 * check-affinity-live.mjs —— 线上取证：好感度到底有没有进到模型眼前的提示里。
 *
 * 为什么需要这个脚本：
 *   好感度曾经「看起来配好了、其实一点没生效」—— 挂载行被分派进了记忆模块，
 *   `【好感度】` 标题后面紧跟的是记忆文件的正文，模型压根没看见好感度是多少。
 *   这种故障**不报错**，只能去会话日志里看提示原文。
 *
 * 做法：
 *   扫 <DSH_HOME>/sessions 下最近改动的会话，解压 session.v4.jsonl.zstd，
 *   取每个会话**最后一条 system/message**（＝最近一次真正发给模型的系统提示），
 *   看 `【好感度】` 后面到底跟的是什么。
 *
 * 判定：
 *   OK     `【好感度】` 后面紧跟 `当前好感度：<数字>`   → 注入正确
 *   MISWIRED `【好感度】` 后面紧跟 `【鲸鱼记忆`        → 注入错位（旧代码，需重启 DSH）
 *   NOSEC  有人设但没有 `【好感度】` 标题              → 压根没注入
 *   含 `【好感度】` 的会话才算样本；普通预设（minimal 等）自动忽略。
 *
 * 用法： node check-affinity-live.mjs [--all]
 *   --all  连 MISWIRED/NOSEC 的会话明细也逐条打印
 *
 * 只读，不写任何文件。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const SHOW_ALL = process.argv.includes('--all');
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh');
const sessionsRoot = join(dshHome, 'sessions');

function fmtPath(p) {
  return p.replace(/\\/g, '/');
}

if (!existsSync(sessionsRoot)) {
  console.log(`[skip] 没有会话目录：${fmtPath(sessionsRoot)}`);
  process.exit(0);
}

/** 收集所有 session.v4.jsonl.zstd，按 mtime 倒序。 */
function collectLogs(dir, depth = 0) {
  const out = [];
  if (depth > 4) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...collectLogs(full, depth + 1));
    else if (e.name === 'session.v4.jsonl.zstd') {
      try {
        out.push({ path: full, mtime: statSync(full).mtimeMs, session: dir.split(/[\\/]/).pop() });
      } catch {
        /* 忽略 */
      }
    }
  }
  return out;
}

/** 取该会话最后一条 system/message 的纯文本。 */
function lastSystemText(file) {
  let raw;
  try {
    raw = zstdDecompressSync(readFileSync(file)).toString('utf8');
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
  let last = null;
  let preset = null;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === 'system/message') last = ev;
    else if (!preset && (ev.type === 'session/start' || ev.type === 'agent/start')) {
      const m = line.match(/鲸鱼娘[^"\\]{0,12}预设/);
      if (m) preset = m[0];
    }
  }
  if (!last) return { error: '没有 system/message' };
  const content = last.data?.message?.content ?? last.data?.content;
  const text = Array.isArray(content)
    ? content.map((c) => (typeof c === 'string' ? c : (c?.text ?? ''))).join('')
    : String(content ?? '');
  return { text, preset, seq: last.seq };
}

const logs = collectLogs(sessionsRoot).sort((a, b) => b.mtime - a.mtime).slice(0, 24);
if (logs.length === 0) {
  console.log('[skip] 一个会话日志都没找到');
  process.exit(0);
}

const rows = [];
for (const log of logs) {
  const got = lastSystemText(log.path);
  if (got.error) continue;
  const text = got.text ?? '';
  if (!text.includes('【好感度】')) continue; // 非鲸鱼预设，忽略

  const idx = text.indexOf('【好感度】');
  const after = text.slice(idx, idx + 120).replace(/\n/g, ' ⏎ ');

  let status;
  let value = null;
  const valueMatch = after.match(/当前好感度：(?:<b>)?(-?\d+)/);
  if (valueMatch) {
    status = 'OK';
    value = Number(valueMatch[1]);
  } else if (after.includes('【鲸鱼记忆')) {
    status = 'MISWIRED';
  } else {
    status = 'NOSEC';
  }
  const bandMatch = text.match(/档次：([^\n]{1,24})/);
  rows.push({
    session: log.session,
    mtime: new Date(log.mtime).toLocaleString('zh-CN', { hour12: false }),
    preset: got.preset ?? '?',
    status,
    value,
    band: bandMatch?.[1]?.trim() ?? null,
    memoryBanners: (text.match(/【鲸鱼记忆/g) ?? []).length,
    after,
  });
}

if (rows.length === 0) {
  console.log('[skip] 最近 24 个会话里没有一个是鲸鱼娘预设（提示里没有【好感度】标题）');
  console.log('       —— 先在 Agent 预设界面选一个鲸鱼娘预设，聊一句再来。');
  process.exit(0);
}

console.log('会话（最近在前，只列鲸鱼娘预设）:');
for (const r of rows) {
  const tag =
    r.status === 'OK'
      ? `OK      值=${r.value}  档位=${r.band ?? '?'}`
      : r.status === 'MISWIRED'
        ? 'MISWIRED 好感度位置被记忆正文占了（旧代码）'
        : 'NOSEC    有人设但没注入好感度段';
  console.log(`  ${r.mtime}  ${r.session.slice(0, 26)}  ${tag}`);
  if (SHOW_ALL && r.status !== 'OK') console.log(`        提示原文：${r.after.slice(0, 90)}`);
}

const ok = rows.filter((r) => r.status === 'OK');
const bad = rows.filter((r) => r.status !== 'OK');
const newest = rows[0];

console.log('');
if (ok.length > 0 && newest.status === 'OK') {
  console.log(
    `RESULT: PASS —— 最近一次发给模型的提示里，好感度段注入正确（当前 ${newest.value} · ${newest.band ?? '?'}）。`,
  );
  if (bad.length > 0) {
    console.log(
      `        另有 ${bad.length} 个更早/其它会话仍是旧状态，属重启前留下的，不影响新会话。`,
    );
  }
  process.exit(0);
}
if (newest.status === 'MISWIRED') {
  console.log('RESULT: FAIL —— 最新提示里【好感度】后面跟的是记忆正文：挂载行被分派错了。');
  console.log('        修法：确认 src/index.js 的 applyEntry 按 config.row 分派，然后重启 DSH 让新代码加载。');
  process.exit(1);
}
if (newest.status === 'NOSEC') {
  console.log('RESULT: FAIL —— 最新提示里有人设但没有【好感度】标题：affinity 行没挂上。');
  console.log('        修法：确认 cordis.patch.yml 里有 4 条 row: affinity 的挂载行，然后重启 DSH。');
  process.exit(1);
}
console.log('RESULT: FAIL —— 没有可判定的样本。');
process.exit(1);
