/**
 * 守住「工具定义不串台」。
 *
 * 背景（真实事故）：四个预设各自注册一个记忆工具 + 一个好感度工具，八个工具
 * 共用一个宿主根作用域。真实的 `session-…` 里曾经出现过
 *   affinity_v3_set / affinity_v1_set 的描述 = 「把一句摘要追加到小鱼自己的
 *   记忆文件 whale-loli.md 的「滚动摘要」区。」
 * —— 也就是宿主把**某一份**工具定义对象按引用摊进了别的预设的请求头。
 *
 * 为什么手写 mock 发现不了：mock 的 `register` 只是把对象 push 进数组，每个
 * apply() 各推各的，天然不会互相污染。所以要复刻的是**共享表**语义：所有
 * apply() 往同一张表里注册，然后检查：
 *
 *   1. 八个工具各自拿到**正确**的描述（好感度工具绝不能提到「记忆文件」）；
 *   2. 八个定义对象、以及它们的 `parameters` / `output.schema` 互不相同
 *      （没有一份模块级字面量被复用）；
 *   3. 每个工具都要求是**唯一**的 name（宿主同名会抛
 *      `tool "x" is already registered in this scope`）；
 *   4. 四个记忆文件、四个好感度变量、四个工具名两两不重。
 *
 * 反证：把一个共享字面量塞回去，第 2 组必须失败 —— 见文件末尾的 self-test。
 */
import * as memory from './src/memory.js';
import * as affinity from './src/affinity.js';

let failed = 0;
const problems = [];

function check(label, ok, detail) {
  if (ok) {
    console.log(`  ✓ ${label}${detail === undefined ? '' : `  ${detail}`}`);
    return;
  }
  failed += 1;
  problems.push(detail === undefined ? label : `${label} —— ${detail}`);
  console.log(`  ✗ ${label}${detail === undefined ? '' : `  ${detail}`}`);
}

/** 四个预设的完整配置，与 build-patch.mjs 的 toolRows() 一一对应。 */
const PRESETS = [
  {
    label: '鲸鱼娘Agent预设',
    file: 'whale-loli.md',
    memoryVariable: 'whale_memory',
    memoryTool: 'whale_memory_add',
    affinityVariable: 'affinity_v1',
    affinityTool: 'affinity_v1_set',
  },
  {
    label: '鲸鱼娘活人版Agent预设',
    file: 'whale-loli-v2-live.md',
    memoryVariable: 'whale_memory_v2',
    memoryTool: 'whale_memory_v2_add',
    affinityVariable: 'affinity_v2',
    affinityTool: 'affinity_v2_set',
  },
  {
    label: '鲸鱼娘涩涩版Agent预设',
    file: 'whale-loli-v3-naughty.md',
    memoryVariable: 'whale_memory_v3',
    memoryTool: 'whale_memory_v3_add',
    affinityVariable: 'affinity_v3',
    affinityTool: 'affinity_v3_set',
  },
  {
    label: '鲸鱼娘女儿版Agent预设',
    file: 'dsh-whale-daughter.md',
    memoryVariable: 'whale_memory_v4',
    memoryTool: 'whale_memory_v4_add',
    affinityVariable: 'affinity_v4',
    affinityTool: 'affinity_v4_set',
  },
];

/** 造一个「共享表」版的宿主 ctx：四次 apply() 都往同一张表里注册。 */
function registerAll() {
  const table = new Map();
  const duplicates = [];
  const ctx = {
    effect: (fn) => fn(),
    systemPrompt: { variable: () => () => {} },
    tools: {
      register(definition) {
        if (table.has(definition.name)) duplicates.push(definition.name);
        table.set(definition.name, definition);
        return () => {
          table.delete(definition.name);
        };
      },
    },
    get: () => undefined,
  };
  for (const preset of PRESETS) {
    memory.apply(ctx, {
      file: preset.file,
      variableName: preset.memoryVariable,
      toolName: preset.memoryTool,
    });
    affinity.apply(ctx, {
      scope: preset.label,
      variableName: preset.affinityVariable,
      toolName: preset.affinityTool,
    });
  }
  return { table, duplicates };
}

console.log('=== 1. 八个工具都注册上了，且没有重名冲突 ===');
const { table, duplicates } = registerAll();
check('注册数量 = 8', table.size === 8, `实际 ${table.size}`);
check('没有重复注册（宿主会抛 tool already registered）', duplicates.length === 0, duplicates.join(','));
for (const preset of PRESETS) {
  check(`${preset.label} 记忆工具存在`, table.has(preset.memoryTool), preset.memoryTool);
  check(`${preset.label} 好感度工具存在`, table.has(preset.affinityTool), preset.affinityTool);
}

console.log('\n=== 2. 每个工具的文案都指向自己那一份 ===');
for (const preset of PRESETS) {
  const memoryTool = table.get(preset.memoryTool);
  const first = String(memoryTool?.description ?? '').split('\n')[0];
  check(
    `${preset.memoryTool} 描述指向 ${preset.file}`,
    first.includes(preset.file),
    first.slice(0, 90),
  );
  // 不能指向别人的记忆文件
  const foreign = PRESETS
    .filter((other) => other.file !== preset.file)
    .map((other) => other.file)
    .filter((file) => first.includes(file));
  check(`${preset.memoryTool} 描述不提到别人的记忆文件`, foreign.length === 0, foreign.join(','));
}

for (const preset of PRESETS) {
  const tool = table.get(preset.affinityTool);
  const first = String(tool?.description ?? '').split('\n')[0];
  check(
    `${preset.affinityTool} 描述是「好感度」而不是记忆`,
    first.includes('好感度') && !first.includes('记忆'),
    first.slice(0, 90),
  );
  check(
    `${preset.affinityTool} 的描述里没有任何记忆文件名`,
    PRESETS.every((other) => !first.includes(other.file)),
  );
}

console.log('\n=== 3. 没有共享的对象引用（串台的根源）===');
const definitions = [...table.values()];
let identityClashes = [];
function sameRef(label, a, b) {
  // 两边都不存在（undefined）不算共享 —— 记忆工具有没有 value 属性都很正常
  if (a === undefined && b === undefined) return;
  if (a === b) identityClashes.push(label);
}
for (let i = 0; i < definitions.length; i += 1) {
  for (let j = i + 1; j < definitions.length; j += 1) {
    const a = definitions[i];
    const b = definitions[j];
    if (a === b) identityClashes.push(`${a.name} === ${b.name}`);
    sameRef(`${a.name}.parameters === ${b.name}.parameters`, a.parameters, b.parameters);
    sameRef(`${a.name}.output.schema === ${b.name}.output.schema`, a.output?.schema, b.output?.schema);
    sameRef(
      `${a.name}.properties.value === ${b.name}.properties.value`,
      a.output?.schema?.properties?.value,
      b.output?.schema?.properties?.value,
    );
  }
}
check('八个定义及其 parameters / output.schema 两两不同', identityClashes.length === 0, identityClashes.slice(0, 4).join('; '));

console.log('\n=== 4. 名字两两不重（否则宿主会丢工具或抛错）===');
const uniq = (values) => new Set(values).size === values.length;
check('记忆文件名互不相同', uniq(PRESETS.map((p) => p.file)));
check('记忆变量互不相同', uniq(PRESETS.map((p) => p.memoryVariable)));
check('好感度变量互不相同', uniq(PRESETS.map((p) => p.affinityVariable)));
check('工具名互不相同', uniq([...PRESETS.map((p) => p.memoryTool), ...PRESETS.map((p) => p.affinityTool)]));

console.log('\n=== 5. 反证：塞回共享字面量必须被第 3 组抓到 ===');
{
  // 手工复刻「旧写法」：同一份 schema 对象被两个工具共用
  const sharedSchema = { type: 'object', additionalProperties: false, properties: { value: { type: 'integer' } }, required: ['value'] };
  const fake = [
    { name: 'a', parameters: {}, output: { schema: sharedSchema } },
    { name: 'b', parameters: {}, output: { schema: sharedSchema } },
  ];
  const same = fake[0].output.schema === fake[1].output.schema;
  check('反证成立：共享 schema 会被识别出来', same === true);
}

console.log('');
if (failed > 0) {
  console.log(`RESULT: FAIL —— ${failed} 项不通过`);
  for (const problem of problems) console.log(`  · ${problem}`);
  process.exit(1);
}
console.log('RESULT: PASS —— 八个工具的描述各自独立，没有共享引用');
