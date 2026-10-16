// 用真实 YAML 解析器 + 注册 !!js 自定义标签来校验 cordis.patch.yml，
// 并复现 DSH 的 entryListProblem 校验逻辑。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DSH_ROOT = 'C:/Users/35453/AppData/Local/Programs/DeepSeek Harness/resources/app/dsh';
const yamlMod = await import(pathToFileURL(DSH_ROOT + '/node_modules/js-yaml/index.js').href);
const yaml = yamlMod.default ?? yamlMod;

const file = process.argv[2];
const src = readFileSync(file, 'utf8');

class JsTag extends yaml.Type {
  constructor() {
    super('tag:yaml.org,2002:js', { kind: 'scalar' });
  }
  resolve(data) {
    return { __js: data };
  }
}
const schema = yaml.DEFAULT_SCHEMA.extend([new JsTag()]);

let doc;
try {
  doc = yaml.load(src, { schema });
} catch (e) {
  console.error('YAML PARSE FAILED:', e.message);
  process.exit(1);
}
console.log('YAML parsed OK. top-level entries:', doc.length);
console.log('entry keys:', JSON.stringify(Object.keys(doc[0])));

const inserts = doc.flatMap((e) => (Array.isArray(e.insert) ? e.insert : []));
console.log('inserted rows:', inserts.length);

// 复现 entryListProblem
function entryListProblem(rows, at = '') {
  if (!Array.isArray(rows)) return at === '' ? 'not a list' : `group ${at} not a list`;
  for (const [i, row] of rows.entries()) {
    const label = at === '' ? `row ${i + 1}` : `${at} row ${i + 1}`;
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return `${label} not a map`;
    const { name, group, config } = row;
    if (typeof name !== 'string' || name === '') return `${label} names no plugin`;
    if (group === true) {
      const nested = entryListProblem(config, label);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

const presetRow = inserts.find((r) => r.id === 'preset-鲸鱼娘Agent预设');
if (!presetRow) {
  console.error('FAIL: preset-鲸鱼娘Agent预设 row not found');
  process.exit(1);
}
const cfg = presetRow.config;
console.log('preset id       =', JSON.stringify(cfg.id));
console.log('preset name     =', JSON.stringify(cfg.name));
console.log('preset order    =', cfg.order);
console.log('preset plugins  =', cfg.plugins.map((p) => p.id).join(', '));

const problem = entryListProblem(cfg.plugins);
console.log('entryListProblem =', problem === undefined ? 'OK (undefined)' : 'FAIL: ' + problem);

const persona = cfg.plugins.find((p) => p.id === 'persona');
const prefix = persona.config.prefix;
console.log('persona prefix bytes =', Buffer.byteLength(prefix, 'utf8'));
console.log('prefix starts:', JSON.stringify(prefix.slice(0, 30)));
console.log('prefix ends  :', JSON.stringify(prefix.slice(-30)));
console.log('contains 炸毛 kaomoji:', prefix.includes('(＃`Д´)'));
console.log('MODE_BASE present:', prefix.includes('【MODE_BASE: minimal】'));

process.exit(problem === undefined ? 0 : 1);
