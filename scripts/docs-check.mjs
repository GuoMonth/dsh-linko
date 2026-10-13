import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const paired = [
  'README.md',
  'ROADMAP.md',
  'CONTRIBUTING.md',
  'SAFETY.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/seo.md',
  'docs/specs/README.md',
  'docs/specs/0001-product-scope.md',
  'docs/decisions/README.md',
  'docs/decisions/0001-clean-room-reference.md',
  'docs/decisions/0002-local-first-cognitive-ledger.md',
  'docs/decisions/0003-bounded-gossip.md',
  'docs/decisions/0004-wasm-boundary.md'
];

const missing = [];
for (const english of paired) {
  const chinese = english.replace(/\.md$/, '.zh.md');
  try {
    await readFile(join(root, chinese));
  } catch {
    missing.push(chinese);
  }
}

if (missing.length > 0) {
  console.error('Missing paired documents:\n' + missing.map((file) => '- ' + file).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Checked ' + paired.length + ' bilingual document pairs.');
}
