import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? '.next';
const hits = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.css')) hits.push(full);
  }
})(root);

const production = hits.filter((item) => item.includes(`${path.sep}static${path.sep}`));
console.log('生产 CSS 分片：');
for (const file of production) console.log(`  ${file} ${(fs.statSync(file).size / 1024).toFixed(1)}KB`);

const source = production.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
// 去掉 CSS 转义的反斜杠后做子串匹配
const plain = source.replace(/\\/g, '');

const needles = [
  'split-pane',
  'side-pane',
  '.sm:grid-cols-[minmax(0,1fr)_12rem]',
  '.sm:grid-cols-[minmax(0,1fr)_11rem]',
  '.sm:grid-cols-[minmax(0,1fr)_auto]',
  '.lg:grid-cols-[minmax(0,1fr)_16rem]',
  '.xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]',
  '.grid-cols-[repeat(auto-fill,minmax(18rem,1fr))]',
  '.grid-cols-[repeat(auto-fill,minmax(14rem,1fr))]',
  '.grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]',
  '@media (min-width: 80rem)',
  '.w-[80%]',
];

console.log(`\n合计 ${(source.length / 1024).toFixed(1)}KB，逐项检查：`);
for (const needle of needles) {
  const count = plain.split(needle).length - 1;
  console.log(`  ${count > 0 ? 'OK  ' : 'MISS'} ${needle} (${count})`);
}
