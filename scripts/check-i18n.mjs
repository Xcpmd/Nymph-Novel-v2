/**
 * 校验界面文案。
 *
 * 扫描源码里出现过的 t('key') 调用，与 zh.ts 中登记的键做比对，
 * 报告缺失的键与从未使用的键，保证文案集中管理不遗漏。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const zhFile = path.join(srcDir, 'lib', 'i18n', 'zh.ts');

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) result.push(full);
  }
  return result;
}

const zhSource = fs.readFileSync(zhFile, 'utf8');
const declared = new Set();
for (const match of zhSource.matchAll(/^\s*'([^']+)':/gm)) {
  declared.add(match[1]);
}

const used = new Set();
const dynamicKeys = new Set();
const files = walk(srcDir).filter((file) => !file.endsWith('zh.ts'));
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) used.add(match[1]);
  for (const match of source.matchAll(/t\(\s*`([^`]+)`/g)) dynamicKeys.add(match[1]);
}

const missing = [...used].filter((key) => !declared.has(key)).sort();
const unused = [...declared].filter((key) => !used.has(key)).sort();

const dynamicPrefixes = [
  'nav.',
  'ai.phase.',
  'batch.status.',
  'workbench.category.',
  'workbench.status.',
  'characters.role.',
  'encyclopedia.category.',
  'settings.scene.',
  'settings.strategy.',
  'history.action.',
  'history.source.',
  'rules.kind.',
  'dsl.target.',
  'dsl.method.',
  'import.mode.',
  'reader.mode.',
  'rules.baseTitle',
];

const reallyUnused = unused.filter((key) => !dynamicPrefixes.some((prefix) => key.startsWith(prefix)));

console.log(`文案键总数：${declared.size}`);
console.log(`代码中直接引用：${used.size}`);
if (dynamicKeys.size > 0) console.log(`模板拼接的动态键：${dynamicKeys.size}`);

if (missing.length > 0) {
  console.error('\n缺失的文案键：');
  for (const key of missing) console.error(`  - ${key}`);
}
if (reallyUnused.length > 0) {
  console.warn('\n未被引用的文案键（可能已废弃）：');
  for (const key of reallyUnused) console.warn(`  - ${key}`);
}

if (missing.length > 0) {
  console.error(`\n检查失败：有 ${missing.length} 个键在代码里使用但未在 zh.ts 登记。`);
  process.exit(1);
}

console.log('\n文案检查通过。');
