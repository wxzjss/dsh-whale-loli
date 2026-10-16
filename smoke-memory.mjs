// 用假 ctx 冒烟测试 memory.js：验证 apply() 注册的 section 形态正确，
// 且 text 回调能按需读盘 / 返回空串。
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
writeFileSync(join(dir, 'whale-loli.md'), '# 记忆\n主人喜欢夜宵 (๑˃̵ᴗ˂̵)\n', 'utf8');
const out = s.text();
console.log('with file ->', JSON.stringify(out.slice(0, 60)));
console.log('含标题:', out.includes('【鲸鱼记忆 · whale-loli.md】'));
console.log('含正文:', out.includes('主人喜欢夜宵'));

// 情况 3：超长 → 截断
writeFileSync(join(dir, 'whale-loli.md'), 'x'.repeat(9000), 'utf8');
const long = mod.apply, txt = registered.length;
const clipped = s.text();
console.log('clipped length <= 6000+banner:', clipped.length < 6200);

// 情况 4：ensureMemoryFile 建骨架
rmSync(join(dir, 'whale-loli.md'));
console.log('ensureMemoryFile ->', mod.ensureMemoryFile());
console.log('骨架写入成功:', mod.readMemory().includes('鲸鱼娘记忆'));
console.log('只有骨架时 readMemory 为空:', mod.readMemory() === '');
console.log('只有骨架时 section 为空:', s.text() === '');

// 情况 4b：骨架 + 一条真内容 → 只留真内容
writeFileSync(
  join(dir, 'whale-loli.md'),
  '# 鲸鱼娘记忆 · whale-loli.md\n\n> 说明行该被丢掉\n\n## 关于主人\n\n主人叫阿澈。\n',
  'utf8',
);
const real = mod.readMemory();
console.log('剥壳后 =', JSON.stringify(real));
console.log('掉了标题/引用:', !real.includes('鲸鱼娘记忆') && !real.includes('说明行'));
console.log('留有真内容:', real.includes('主人叫阿澈'));

// 情况 5：memoryPath 尊重 DSH_HOME
console.log('memoryPath =', mod.memoryPath());

rmSync(dir, { recursive: true, force: true });
console.log('SMOKE OK');
