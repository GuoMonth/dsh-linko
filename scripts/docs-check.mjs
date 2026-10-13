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
  'docs/specs/0002-message-envelope.md',
  'docs/specs/0003-lan-sync-and-transport.md',
  'docs/specs/0004-group-chat-and-e2ee.md',
  'docs/specs/0005-state-and-storage.md',
  'docs/review.md',
  'packages/web/DESIGN.md',
  'packages/node/README.md',
  'docs/decisions/README.md',
  'docs/decisions/0001-clean-room-reference.md',
  'docs/decisions/0002-local-first-cognitive-ledger.md',
  'docs/decisions/0003-bounded-gossip.md',
  'docs/decisions/0004-wasm-boundary.md',
  'docs/decisions/0005-local-node-rest-sync-websocket.md',
  'docs/decisions/0006-lan-discovery-and-transport-profile.md',
  'docs/decisions/0007-group-chat-and-e2ee-boundary.md',
  'docs/decisions/0008-minimal-kernel-and-verification.md'
];

const missing = [];
const invalid = [];
for (const english of paired) {
  const chinese = english.replace(/\.md$/, '.zh.md');
  try {
    const [englishText, chineseText] = await Promise.all([
      readFile(join(root, english), 'utf8'),
      readFile(join(root, chinese), 'utf8')
    ]);
    if (chineseText.trim().length < 80) {
      invalid.push(`${chinese} is empty or too short`);
    }
    const englishHeadings = englishText.match(/^#{1,6} /gm) ?? [];
    const chineseHeadings = chineseText.match(/^#{1,6} /gm) ?? [];
    if (englishHeadings.length !== chineseHeadings.length) {
      invalid.push(`${english} and ${chinese} have different heading counts`);
    }
  } catch {
    missing.push(chinese);
  }
}

if (missing.length > 0) {
  console.error('Missing paired documents:\n' + missing.map((file) => '- ' + file).join('\n'));
  process.exitCode = 1;
}
if (invalid.length > 0) {
  console.error('Invalid paired documents:\n' + invalid.map((file) => '- ' + file).join('\n'));
  process.exitCode = 1;
}
if (missing.length === 0 && invalid.length === 0) {
  console.log('Checked ' + paired.length + ' bilingual document pairs with content and heading parity.');
}
