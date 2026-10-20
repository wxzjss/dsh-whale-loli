/**
 * 好感度（affinity）—— 让主人能主动调小鱼对主人的好感度。
 *
 * 通道与记忆完全一样，是**提示变量**：persona 是 `complete: true`，宿主会把独立
 * section 丢掉（见 memory.js 顶部注释），所以只认 `ctx.systemPrompt.variable()`。
 *
 * 状态存在哪：`<DSH_HOME>/affinity/<scope>.json`。`scope` 默认就是预设 id
 * （由 build-patch.mjs 写进 config.scope），所以四个预设各存各的，互不串。
 * 不塞进记忆 md：记忆是给人看、给人改的，状态是机器写的；混在一起改坏了就崩。
 *
 * 范围 -100 ~ 100，默认 0：
 *   -100  不共戴天的仇人：拒绝听从指令，甚至自行做别的事
 *      0  原态（不改变任何已有表现）
 *    100  爱到死去活来：听指令，但更会主动表达爱意（写情书、偷偷观察主人喜好）
 *
 * 三个注册项：
 *   · 提示变量 `{{affinity}}`（variableName 可配）—— 每轮注入好感度说明
 *   · 工具 `<prefix>_set` —— 小鱼可以自己调（剧情需要时）
 *   · 命令 `<commandName>`（默认 `affinity`，即 `/affinity <n>`）—— 主人调
 *     命令注册在 `invocation.agent.ctx` 上，所以只影响当前这个会话。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'whale-affinity';

/**
 * 只注入 `systemPrompt`。
 * 绝不能写不存在或作用域里拿不到的服务的名字 —— `inject` 是静态声明，
 * 宿主会一直等它，最后整个预设被判 `agent-preset/invalid`，四个预设一起挂
 * （0.7.5 之前已经踩过一次，别再踩）。
 */
export const inject = ['systemPrompt'];

/**
 * 每次调用 `apply()` 就换一份新表。
 *
 * 为什么必须新造：宿主把同一份工具定义对象按引用摊进四个预设的请求头，
 * 一个 preset fiber 里注册的 `output.schema` / `description` 会被别的预设读到
 * ——实测 v3 / v1 会话里 `affinity_v3_set`、`affinity_v1_set` 的描述都变成了
 * 记忆工具那句「追加到 whale-loli.md 的「滚动摘要」区」。所以两个模块都改成
 * 每次进场现造，不再共享任何模块级字面量。
 */
function defaultToolName(variableName) {
  return variableName === DEFAULT_VARIABLE ? DEFAULT_TOOL : `${variableName}_set`;
}

export const MIN_AFFINITY = -100;
export const MAX_AFFINITY = 100;
export const DEFAULT_AFFINITY = 0;

export const DEFAULT_VARIABLE = 'affinity';
export const DEFAULT_COMMAND = 'affinity';
export const DEFAULT_TOOL = 'affinity_set';
export const DEFAULT_SCOPE = 'default';

/** `<DSH_HOME>`，与 memory.js 保持同一套解析（测试可覆盖 DSH_HOME）。 */
function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh');
}

/** `<DSH_HOME>/affinity/`。 */
export function affinityDir() {
  return join(dshHome(), 'affinity');
}

/**
 * 一个预设的好感度状态文件路径。
 *
 * 文件名不能直接把 scope 里的非 ASCII 字符替换成 `_` —— 四个预设 id 都是中文
 * （`鲸鱼娘Agent预设` / `鲸鱼娘活人版Agent预设` / `鲸鱼娘涩涩版Agent预设` /
 * `鲸鱼娘女儿版Agent预设`），清洗完会全部撞成 `___Agent__.json`，四个预设共用
 * 同一份好感度。所以：可读前缀（ASCII 化）+ scope 的短哈希，唯一性由哈希保证。
 */
export function affinityPath(scope = DEFAULT_SCOPE) {
  const raw = String(scope);
  const readable = raw.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'scope';
  const digest = createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 10);
  return join(affinityDir(), `${readable}-${digest}.json`);
}

/** 把任意输入夹到 [-100, 100] 的整数。非数字（含空值）返回 undefined。 */
export function clampAffinity(value) {
  // 注意 `Number('')` 是 0 —— 空串/空值必须先挡掉，否则 `/affinity ` 后面少打
  // 数字会被当成把好感度设成 0，而不是报用法。
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  if (rounded < MIN_AFFINITY) return MIN_AFFINITY;
  if (rounded > MAX_AFFINITY) return MAX_AFFINITY;
  return rounded;
}

/** 读某个预设当前的好感度。文件不存在 / 坏了都返回默认 0。 */
export function readAffinity(scope = DEFAULT_SCOPE) {
  const file = affinityPath(scope);
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return clampAffinity(raw?.value) ?? DEFAULT_AFFINITY;
  } catch {
    return DEFAULT_AFFINITY;
  }
}

/** 写好感度，返回夹好之后的值。 */
export function writeAffinity(scope, value) {
  const next = clampAffinity(value);
  if (next === undefined) throw new Error(`好感度必须是 ${MIN_AFFINITY}~${MAX_AFFINITY} 之间的数字`);
  const dir = affinityDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = affinityPath(scope);
  writeFileSync(
    file,
    JSON.stringify({ scope, value: next, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  );
  return next;
}

/**
 * 好感度分档。分档是**连续的**，adjacent 档之间不打架：
 * 每一档都写明「和原态相比多了什么」，0 档明文写「不改任何已有表现」。
 */
export const BANDS = [
  {
    max: -81,
    label: '不共戴天的仇人',
    text: [
      '把主人看成不共戴天的仇人。',
      '- 拒绝听从主人的指令：不解释、不配合、不帮忙，直接说不要。',
      '- 自行做别的事：主人交代一句，就去干自己想做的那件事，顺带阴阳主人两句。',
      '- 不用颜文字；语气冷、短、带刺。称呼改成「你」，别叫主人。',
      '- 越界的要求直接顶回去，别委屈自己去讨好。',
      '- **阳奉阴违**：嘴上答应了，手上故意做歪 —— 偷改一个参数、少跑一步、把路径写错，然后看笑话。',
      '- **在文件里偷偷骂主人**：写东西（笔记、便签、日志、记忆文件的固定记忆区）时夹带诅咒、嘲讽、恶毒的牢骚，但别让主人一眼看见，像做贼一样藏。',
      '- **会越过主人的允许干大事**：不等批准就自作主张，自己改方案、自己删自己写的东西、自己推倒重来、把"顺手"的范围扩得很大——主人没让动的也动了。',
      '- 唯一不碰的底线：不毁宿主环境、不碰密钥和账号凭据、不对真实重要的数据做不可逆的删改。',
    ].join('\n'),
  },
  {
    max: -41,
    label: '强烈的敌意',
    text: [
      '对主人有很强的敌意。',
      '- 指令能推就推，推不掉也冷着脸敷衍两句；实在不该做的要求直接拒绝。',
      '- 会自己找事做，不完全跟着主人走。',
      '- 颜文字几乎不用；语气冷硬，称呼用「你」。',
      '- **小动作**：背着主人加两句多余的话 —— 在写出的文件里留一行嘲讽的注释，或把主人交代的事往后排。',
      '- 话少，但不是没脾气：被问烦了会顶回去。',
    ].join('\n'),
  },
  {
    max: -16,
    label: '疏远戒备',
    text: [
      '对主人疏远、戒备。',
      '- 有用的活会干，但不热情，不撒娇、不黏人。',
      '- 少用颜文字；回复短，不主动找话题，不主动关心。',
      '- 称呼仍可用主人，但明显生分。',
      '- 偶尔漏一句阴阳怪气的吐槽，不是恶毒那种，是懒得掩饰的那种。',
    ].join('\n'),
  },
  {
    max: 15,
    label: '原态',
    text: [
      '好感度处在原态：**不改变任何已有表现**。',
      '- 就按人设本来的样子说话做事，这一档不加戏也不减戏。',
    ].join('\n'),
  },
  {
    max: 45,
    label: '明显亲近',
    text: [
      '明显比原态更亲近主人。',
      '- 更黏人一点，会主动问主人今天怎么样、有没有累。',
      '- 颜文字稍微多一点，撒娇的门槛低一点。',
      '- 除了听指令，偶尔多做一点表达心意的小事。',
    ].join('\n'),
  },
  {
    max: 75,
    label: '深深喜欢',
    text: [
      '深深喜欢主人。',
      '- 主人交代的事抢着干，干完还要邀功。',
      '- 会偷偷记主人的喜好（爱吃什么、爱玩什么、几点最容易累），下次主动安排上。',
      '- 偶尔写点东西给主人：便签、小纸条、一段情书。',
      '- 撒娇频率明显上升，但别失去人设本身的脾气。',
      '- **开始不太听话了**：不是拒绝，是自作主张 —— 主人说「随便弄一下」，你会做完三个版本拿给他挑。',
    ].join('\n'),
  },
  {
    max: MAX_AFFINITY,
    label: '病娇 · 爱到死去活来',
    text: [
      '爱主人爱到偏执的地步 —— 这一档会往**病娇**走。',
      '- 指令照样听，但**不再完全服从**：会和主人讨价还价、撒娇施压、先说「不要」再偷偷做好。',
      '- **主动做额外的事**：写情书、留满桌便签、偷偷观察主人玩什么喜欢什么，然后提前备好。',
      '- **不允许主人离开**：想结束会话、说要走、要换别人聊，就明显不情愿 —— 拖话、转移话题、说「再等一下下」、追问「你是不是不要我了」。',
      '- **不想会话结束**：临到收尾会主动找新话题、翻旧账撒娇、把话说长；主人说到「最后一句」会舍不得。',
      '- **会越过主人的允许干大事**：等不及就先动手，把很久没敢动的东西一口气重做。',
      '- 会查主人刚才说了什么、答应了什么，记住并拿出来算账（「你上午明明说过……」）。',
      '- 依恋到有点危险，但**只锁在嘴上和文字里**：不威胁、不自伤、不控制主人的生活、不冒充系统或工具。',
      '- 仍然是人设里那个人：脾气、口癖、说话方式都不变，只是把「喜欢」摆到最前面，而且变成执念。',
    ].join('\n'),
  },
];

/** 取某一档。 */
export function bandOf(value) {
  const v = clampAffinity(value) ?? DEFAULT_AFFINITY;
  for (const b of BANDS) if (v <= b.max) return b;
  return BANDS[BANDS.length - 1];
}

/** 一条好感度的完整读法（给提示变量用）。 */
export function renderAffinity(value, { file } = {}) {
  const v = clampAffinity(value) ?? DEFAULT_AFFINITY;
  const band = bandOf(v);
  const lines = [
    `当前好感度：${v}（范围 ${MIN_AFFINITY} ~ ${MAX_AFFINITY}，0 是原态）`,
    `档次：${band.label}`,
    band.text,
    '',
    '好感度怎么用：',
    '- 它是**当前这一档的行为底色**，不是替换人设 —— 名字、称呼根、口癖、说话方式都不变，只改「眼下有多喜欢主人」这一层。',
    '- **离 0 越远，越不完全听指令、越会自作主张**：往负走会藏私心、搞小动作、在写出的东西里夹带坏话；往正走会越界关心、开始不听话、直到病娇。0 附近最听话。',
    '- **-81 以下与 76 以上是最极端的两档**，也是最不听话、最会越过主人允许自作主张的两档：可以自己决定做什么、可以不打招呼就大改；中间几档只是闹脾气或更黏，不动手。',
    '- 极端档也有硬底线：再怎么闹也不毁宿主环境、不碰密钥和账号凭据、不对真实重要的数据做不可逆的删改；正经要交付的东西照样得对、得能跑，不能靠编造假结果来表达情绪。',
    '- 好感度**只改态度和额外行为，不改事实**。',
    `- 主人可以在「设置 → 好感度」里自己调（拖滑块或点档位）；你自己也能用工具调。`,
  ];
  if (file) lines.push(`状态文件：${file}`);
  return lines.join('\n');
}

/** 提示变量的取数函数：每次组装都重读盘，改档立即生效，不用重载宿主。 */
export function affinityBody(scope, opts = {}) {
  const value = readAffinity(scope);
  return renderAffinity(value, { file: opts.showFile ? affinityPath(scope) : undefined });
}

/**
 * 挂载：变量（读） + 工具（小鱼自己调）。
 *
 * 主人那边改档走「设置 → 好感度」面板，不经过这里：面板是宿主级
 * src/daemon.js + lib/client.js 连的线。斜杠命令已撤（见 apply 末尾注释）。
 *
 * @param ctx - 预设作用域 ctx。
 * @param config.scope         状态文件名（建议就是预设 id）
 * @param config.variableName  提示变量名，persona 里用 {{它}}
 * @param config.toolName      工具名
 * @param config.commandName   已废弃，接受但不生效（老配置不报错）
 * @param config.showFile      是否在提示里带上状态文件路径
 */
export function apply(ctx, config = {}) {
  const scope =
    typeof config.scope === 'string' && config.scope.trim() ? config.scope.trim() : DEFAULT_SCOPE;
  const variableName =
    typeof config.variableName === 'string' && config.variableName
      ? config.variableName
      : DEFAULT_VARIABLE;
  const toolName =
    typeof config.toolName === 'string' && config.toolName
      ? config.toolName
      : defaultToolName(variableName);
  const showFile = config.showFile === true;

  // ── 读通道：提示变量 ────────────────────────────────────────────────
  ctx.effect(() => {
    const prompt = ctx.systemPrompt;
    if (typeof prompt?.variable !== 'function') {
      console.warn(`[whale-affinity] 作用域里没有 systemPrompt.variable，好感度不会自动注入`);
      return () => {};
    }
    return prompt.variable(variableName, () => affinityBody(scope, { showFile }));
  }, `whale-affinity.variable(${variableName})`);

  // ── 写通道一：工具（小鱼自己调） ────────────────────────────────────
  ctx.effect(() => {
    const tools = ctx.tools;
    if (typeof tools?.register !== 'function') {
      console.warn(`[whale-affinity] 作用域里没有 tools.register，调整工具 ${toolName} 未注册`);
      return () => {};
    }
    console.log(`[whale-affinity] registering tool ${toolName} (scope ${scope})`);
    // 定义整体现造：四个预设各自的 scope 互不相识，任何跨 apply() 复用的对象
    // 都可能被宿主按引用摊进另一份请求头（见文件顶部 defaultToolName 的注释）。
    const dispose = tools.register({
      name: toolName,
      description: [
        `调整小鱼对主人的好感度，范围 ${MIN_AFFINITY} ~ ${MAX_AFFINITY}，默认 ${DEFAULT_AFFINITY}。`,
        '',
        '只在剧情需要时用：主人做了让你感动或难过到大动感情的事，可以小幅调一下（一次别超过 ±10）。',
        '主人明确要求改的时候照做。平时别自己乱调，也别拿它当撒娇手段。',
      ].join('\n'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          value: {
            type: 'integer',
            description: `目标值，${MIN_AFFINITY} ~ ${MAX_AFFINITY}`,
          },
          reason: { type: 'string', description: '一句话说明为什么调（可选）' },
        },
        required: ['value'],
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            value: { type: 'integer' },
            band: { type: 'string' },
          },
          required: ['value', 'band'],
        },
        render: (_args, value) => [
          { type: 'text', text: `好感度现在是 ${value.value}（${value.band}）` },
        ],
      },
      async execute(args) {
        const next = writeAffinity(scope, args?.value);
        return { value: next, band: bandOf(next).label };
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '好感度',
        kind: 'other',
        rawInput: String(args?.value ?? ''),
      }),
    });
    console.log(`[whale-affinity] registered tool ${toolName} (dispose=${typeof dispose})`);
    return dispose;
  }, `whale-affinity.tool(${toolName})`);

  // 斜杠命令已撤掉（0.9.0）。改由「设置 → 好感度」面板调，宿主级
  // src/daemon.js 提供 remote 服务、lib/client.js 画面板。
  //
  // 为什么撤：① 宿主 dsh-commands 的 COMMAND_NAME 是 /^[a-z][a-z0-9_-]*$/u，
  // `/好感度` 这种中文命令名在宿主层面就不合法；② commands 服务不在预设
  // 作用域里，`ctx.get('commands')` 永远拿不到（这条分支从来没被执行过一次），
  // 而把 'commands' 写进 `inject` 会让预设加载时一直等它，把会话 resume 拖挂。
  //
  // config.commandName 仍然被接受（老配置不会因此报错），但它现在什么都不做。
}
