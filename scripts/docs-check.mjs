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
  'docs/decisions/README.md',
  'docs/decisions/0001-clean-room-reference.md',
  'docs/decisions/0002-local-first-cognitive-ledger.md',
  'docs/decisions/0003-bounded-gossip.md',
  'docs/decisions/0004-wasm-boundary.md',
  'docs/decisions/0005-local-node-rest-sync-websocket.md',
  'docs/decisions/0006-lan-discovery-and-transport-profile.md',
  'docs/decisions/0007-group-chat-and-e2ee-boundary.md'
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
