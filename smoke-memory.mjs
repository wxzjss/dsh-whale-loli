// 用假 ctx 冒烟测试 memory.js：验证 apply() 注册的 section 形态正确，
// 且 text 回调能按需读盘 / 返回空串。
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'whale-mem-'));
process.env.DSH_HOME = dir;

const mod = await import('./src/memory.js');

const registered = [];
const ctx = {
  systemPrompt: {
    getSectionOrder: (n) => (n === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : undefined),
    section: (s) => {
      registered.push(s);
      return () => {};
    },
  },
  effect: (fn, label) => {
    console.log('effect label:', label);
    return fn();
  },
};

mod.apply(ctx, {});

console.log('sections registered:', registered.length);
const s = registered[0];
console.log('name  =', s.name);
console.log('order =', s.order, '(应 < 0)');
console.log('interpolate =', s.interpolate);
console.log('text is function:', typeof s.text === 'function');

// 情况 1：文件不存在 → 空串
console.log('no file ->', JSON.stringify(s.text()));

// 情况 2：文件存在且短 → 全文
writeFileSync(join(dir, 'whale-loli.md'), '# 记忆\n\n## 重要记忆\n\n- 主人喜欢夜宵 (๑˃̵ᴗ˂̵)\n', 'utf8');
const out = s.text();
console.log('with file ->', JSON.stringify(out.slice(0, 60)));
console.log('含标题:', out.includes('【鲸鱼记忆 · whale-loli.md】'));
console.log('含正文:', out.includes('主人喜欢夜宵'));
console.log('含分区标题:', out.includes('## 重要记忆'));

// 情况 3：超长 → 截断（先丢旧轮次，再动重要记忆）
const many = Array.from({ length: 200 }, (_, i) => `- 第${i + 1}轮：${'x'.repeat(120)}`);
writeFileSync(
  join(dir, 'whale-loli.md'),
  `# 记忆\n\n## 重要记忆\n\n- 永久一条\n\n## 对话记录\n\n${many.join('\n')}\n`,
  'utf8',
);
const clipped = s.text();
console.log('clipped length <= 16000+banner:', clipped.length < 16400, `实际 ${clipped.length}`);
console.log('截断后重要记忆仍在:', clipped.includes('永久一条'));
console.log('只注入最近 <=80 轮:', (clipped.slice(clipped.indexOf('## 对话记录')).match(/^- /gm) ?? []).length <= 80);

// 情况 4：ensureMemoryFile 建骨架
rmSync(join(dir, 'whale-loli.md'));
const tmpl = readFileSync(mod.ensureMemoryFile(), 'utf8');
console.log('ensureMemoryFile ->', mod.memoryPath());
console.log('骨架含重要记忆区:', tmpl.includes('## 重要记忆'));
console.log('骨架含对话记录区:', tmpl.includes('## 对话记录'));
console.log('骨架写了 80 轮上限:', tmpl.includes('最近 80 轮'));
console.log('只有骨架时 readMemory 为空:', mod.readMemory() === '');
console.log('只有骨架时 section 为空:', s.text() === '');

// 情况 4b：骨架 + 两条真内容 → 只留真内容
writeFileSync(
  join(dir, 'whale-loli.md'),
  '# 鲸鱼娘记忆 · whale-loli.md\n\n> 说明行该被丢掉\n\n## 重要记忆\n\n> 分区说明也该丢\n\n- 主人叫阿澈。\n\n## 对话记录\n\n- 2026-10-18 主人：在吗 / 小鱼：在 (≧▽≦)\n',
  'utf8',
);
const real = mod.readMemory();
console.log('剥壳后含永久条目:', real.includes('主人叫阿澈'));
console.log('剥壳后含对话轮次:', real.includes('2026-10-18 主人：在吗'));
console.log('掉了标题/引用:', !real.includes('# 鲸鱼娘记忆') && !real.includes('说明行该被丢掉'));
console.log('保留了 ### 结构:', real.includes('## 重要记忆'));

// 情况 5：memoryPath 尊重 DSH_HOME
console.log('memoryPath =', mod.memoryPath());

rmSync(dir, { recursive: true, force: true });
console.log('SMOKE OK');
