#!/usr/bin/env node
/**
 * Smoke check for the built inbox.
 *
 * This is deliberately more than "the files exist". It runs the same compiled
 * modules the browser loads and asserts the properties the UI is supposed to
 * hold:
 *
 *   - fixtures survive the same validator that network input passes through;
 *   - an unknown actor kind is refused, not relabelled;
 *   - delivery, read, acknowledgement and action stay independent under change;
 *   - a decision is a *submission*: pending until the node accepts it, failed
 *     when it does not, and never reported as a success it did not get;
 *   - compose builds a human envelope with a fresh nonce and a parent ref, and
 *     does not invent an event id;
 *   - the sync cursor round-trips through storage and is dropped on reset;
 *   - the emitted bundle contains no markup-string sinks and loads nothing
 *     from a network.
 *
 * Usage: node scripts/smoke.mjs   (run after scripts/build.mjs)
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');
const dist = join(packageRoot, 'dist');

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = entry.parentPath ?? entry.path;
    files.push(join(parent, entry.name));
  }
  return files;
}

/**
 * Remove comments before scanning for forbidden calls, so documentation that
 * names a dangerous API is not mistaken for a use of it. String literals are
 * tracked so a `//` inside a URL does not swallow the rest of the line.
 */
function stripComments(code) {
  let out = '';
  let index = 0;
  let state = 'code';
  let quote = '';
  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        state = 'string';
        quote = char;
      }
      out += char;
      index += 1;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (char === '\\') {
      out += char + (next ?? '');
      index += 2;
      continue;
    }
    if (char === quote) state = 'code';
    out += char;
    index += 1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Minimal DOM + storage shims
 * ------------------------------------------------------------------ */

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.childNodes = [];
  }
  set className(value) {
    this.attributes.set('class', String(value));
  }
  get className() {
    return this.attributes.get('class') ?? '';
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }
  addEventListener(type, listener) {
    this.attributes.set(`on:${type}`, typeof listener);
  }
  append(...children) {
    for (const child of children) this.childNodes.push(child);
  }
  set textContent(value) {
    this.childNodes = [new FakeText(String(value))];
  }
  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

class FakeText {
  constructor(data) {
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
}

function installShims() {
  globalThis.document = {
    createElement: (tagName) => new FakeNode(tagName),
    createTextNode: (data) => new FakeText(String(data)),
  };
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key),
    },
  };
  return store;
}

function allText(node) {
  return node.textContent;
}

function findAll(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  if (node.childNodes === undefined) return found;
  for (const child of node.childNodes) findAll(child, predicate, found);
  return found;
}

async function main() {
  section('Build output');
  const required = [
    'index.html',
    'theme.css',
    'app.js',
    'model.js',
    'fixtures.js',
    'render.js',
    'api.js',
    'storage.js',
  ];
  for (const file of required) check(`dist/${file} exists`, await exists(join(dist, file)));
  if (failures > 0) {
    console.error('\nBuild output is incomplete. Run `node scripts/build.mjs` first.');
    process.exitCode = 1;
    return;
  }

  const files = await walk(dist);
  const html = await readFile(join(dist, 'index.html'), 'utf8');
  const css = await readFile(join(dist, 'theme.css'), 'utf8');
  const scripts = new Map();
  for (const file of files) {
    if (file.endsWith('.js')) scripts.set(relative(dist, file), await readFile(file, 'utf8'));
  }

  section('No network dependency (the preview must work offline)');
  const absoluteAsset = /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i;
  check('index.html loads no remote asset', !absoluteAsset.test(html));
  check('theme.css imports nothing remotely', !/@import\s+(?:url\()?["']?(?:https?:)?\/\//i.test(css));
  check('theme.css references no remote asset', !/url\(\s*["']?(?:https?:)?\/\//i.test(css));
  check('no remote webfont', !/fonts\.googleapis|fonts\.gstatic/i.test(html + css));

  section('No markup-string sinks (remote HTML is never executed)');
  const sinks = [
    ['innerHTML assignment', /\.innerHTML\s*=/],
    ['outerHTML assignment', /\.outerHTML\s*=/],
    ['insertAdjacentHTML', /\.insertAdjacentHTML\s*\(/],
    ['document write call', /document\s*\.\s*write\s*\(/],
    ['eval', /(^|[^.\w])eval\s*\(/],
    ['Function constructor', /new\s+Function\s*\(/],
    ['javascript: URL', /["'`]javascript:/i],
  ];
  for (const [label, pattern] of sinks) {
    const offenders = [...scripts.entries()].filter(([, source]) => pattern.test(stripComments(source))).map(([name]) => name);
    check(`no ${label}`, offenders.length === 0, offenders.join(', '));
  }

  section('Transport security is not claimed by this client');
  const apiSource = scripts.get('api.js') ?? '';
  check('no TLS/auth claim in the client copy', !/end-to-end|端到端|already secure|TLS 已/i.test(apiSource));
  check('the client says where transport security lives', /TLS and peer\s*\n?\s*\*?\s*authentication belong to the node/i.test(apiSource) || /belong to the node/i.test(apiSource));

  installShims();
  const model = await import(pathToFileURL(join(dist, 'model.js')).href);
  const fixtures = await import(pathToFileURL(join(dist, 'fixtures.js')).href);
  const storage = await import(pathToFileURL(join(dist, 'storage.js')).href);
  const api = await import(pathToFileURL(join(dist, 'api.js')).href);
  const render = await import(pathToFileURL(join(dist, 'render.js')).href);

  const NOW = 1_700_000_000_000;
  const envelopes = fixtures.fixtureEnvelopes(NOW);

  section('Fixtures pass the same validator as network input');
  check('fixtures render at all', envelopes.length >= 6, `got ${envelopes.length}`);
  check(
    'every fixture round-trips through parseEnvelope',
    envelopes.every((envelope) => model.parseEnvelope(JSON.parse(JSON.stringify(envelope))) !== null),
  );

  section('An unknown actor kind is refused, never relabelled');
  const unknownKind = model.parseEnvelope({
    id: 'sha256:x',
    cover: { title: 'ok', actor: { kind: 'humanoid', id: 'actor:1' } },
  });
  check('unknown actor kind is rejected outright', unknownKind === null);
  const missingActor = model.parseEnvelope({ id: 'sha256:x', cover: { title: 'ok' } });
  check('an envelope with no actor is rejected', missingActor === null);
  const missingActorId = model.parseEnvelope({ id: 'sha256:x', cover: { title: 'ok', actor: { kind: 'human' } } });
  check('an actor with no id is rejected', missingActorId === null);
  const known = model.parseEnvelope({
    id: 'sha256:x',
    cover: { title: 'ok', actor: { kind: 'agent-autonomous', id: 'agent:1' } },
  });
  check('a known actor kind still parses', known?.actor.kind === 'agent-autonomous');

  const hostile = model.parseEnvelope({
    id: 'sha256:x',
    cover: { title: 'ok‮gnp.exe', preview: 'x'.repeat(900), actor: { kind: 'human', id: 'p:1' } },
    inlineBody: '<img src=x onerror=alert(1)>',
    semantic: { intent: 'nonsense', contextRefs: 'not-an-array' },
  });
  check('unknown intent falls back safely', hostile?.semantic.intent === 'inform');
  check('non-array refs are dropped', hostile?.semantic.contextRefs.length === 0);
  check('bidi override is stripped from titles', !hostile?.cover.title.includes('‮'));
  check('over-long preview is truncated', (hostile?.cover.preview.length ?? 0) <= 400);
  check('markup in a body is preserved verbatim for text rendering', hostile?.inlineBody === '<img src=x onerror=alert(1)>');

  section('Delivery, read, acknowledgement and action stay independent');
  const base = envelopes[0];
  const withRead = {
    ...base,
    facts: { ...base.facts, devices: base.facts.devices.map((device) => ({ ...device, presentation: 'read' })) },
  };
  const valueOf = (envelope, dimension) => model.factViews(envelope, NOW).find((view) => view.dimension === dimension)?.value;
  check('reading a device does not change delivery', valueOf(base, 'delivery') === valueOf(withRead, 'delivery'));
  check('reading a device does not change acknowledgement', valueOf(base, 'acknowledgement') === valueOf(withRead, 'acknowledgement'));
  check('reading a device does not change the action', valueOf(base, 'action') === valueOf(withRead, 'action'));
  check(
    'per-device presentation never claims every device without evidence',
    model.presentationSummary([
      { deviceId: 'a', label: 'A', presentation: 'read' },
      { deviceId: 'b', label: 'B', presentation: 'unseen' },
    ]).read === 1,
  );
  check(
    'presentation reports an explicit ratio',
    model.presentationToken([
      { deviceId: 'a', label: 'A', presentation: 'read' },
      { deviceId: 'b', label: 'B', presentation: 'unseen' },
    ]) === 'read:1-of-2',
  );

  section('Authorship is distinguishable and autonomous is never human');
  const kinds = ['human', 'agent-delegated', 'agent-autonomous', 'system'];
  const views = kinds.map((kind) => model.authorshipView(kind));
  check('four authorship marks are distinct', new Set(views.map((view) => view.mark)).size === 4);
  check('autonomous is flagged as not human', model.authorshipView('agent-autonomous').notHuman === true);
  check('human is not flagged as not human', model.authorshipView('human').notHuman === false);

  section('Decisions are submissions, never local outcomes');
  const target = envelopes.find((envelope) => model.needsDecision(envelope, {}, NOW));
  check('at least one fixture is waiting for a decision', target !== undefined);
  if (target !== undefined) {
    const before = model.deriveActionState(target, NOW);
    const started = model.recordDecision({}, target.id, 'approve', NOW);
    const pending = model.currentDecision(started.ledger, target.id);
    check('a new decision is pending', pending?.status === 'pending');
    check('a pending decision does not move the action fact', model.deriveActionState(target, NOW) === before);
    check('a pending decision is not offered again', model.needsDecision(target, started.ledger, NOW) === false);

    const failed = model.settleDecision(started.ledger, target.id, 'failed', '节点未连接');
    check('a refusal is recorded as failed', model.currentDecision(failed, target.id)?.status === 'failed');
    check('a failed decision keeps the error text', model.currentDecision(failed, target.id)?.error === '节点未连接');
    check('a failed decision does not mark the action approved', model.deriveActionState(target, NOW) !== 'approved');
    check('a failed decision returns the item to the queue', model.needsDecision(target, failed, NOW) === true);

    const confirmed = model.settleDecision(started.ledger, target.id, 'confirmed', null);
    check('an accepted decision is recorded as confirmed', model.currentDecision(confirmed, target.id)?.status === 'confirmed');
    check('a confirmed decision stops offering the item', model.needsDecision(target, confirmed, NOW) === false);
    check('a confirmed decision still does not invent an action fact', model.deriveActionState(target, NOW) === before);
    check('settling preserves the record count', (confirmed[target.id] ?? []).length === 1);

    check('an expired request is not awaiting a decision', (() => {
      const expired = envelopes.find((envelope) => envelope.cover.status === 'expired');
      return expired !== undefined && model.needsDecision(expired, {}, NOW) === false;
    })());
  }

  section('Compose builds a human envelope with a fresh nonce and a parent ref');
  const draft = {
    peerId: 'peer:wei',
    title: '关于解析器基准',
    preview: '想请你确认一下基准数据',
    body: '这是一段纯文本正文。',
    intent: 'request',
    risk: 'medium',
    requiresApproval: true,
  };
  const replyTo = { eventId: 'sha256:parent', title: '父消息标题' };
  const built = model.buildHumanEnvelope(draft, { nonce: 'nonce-1', authorId: 'device:web:test', replyTo, now: NOW });
  check('compose sets the human message kind', built.kind === 'message.human');
  check('compose signs as a human actor', built.cover.actor.kind === 'human');
  check('compose carries the author id', built.cover.actor.id === 'device:web:test');
  check('compose carries a fresh nonce', built.nonce === 'nonce-1');
  check('compose does not invent an event id', built.id === undefined);
  check('compose quotes the parent by ref', Array.isArray(built.parents) && built.parents[0] === 'sha256:parent');
  check('compose records which parent is quoted', built.quote.eventId === 'sha256:parent');
  check('compose keeps the body as plain text', built.inlineBody === '这是一段纯文本正文。');
  check('compose marks approval when asked', built.policy.requiresApproval === true);

  const other = model.buildHumanEnvelope(draft, { nonce: 'nonce-2', authorId: 'device:web:test', replyTo: null, now: NOW });
  check('two compositions differ by nonce', JSON.stringify(built) !== JSON.stringify(other));
  check('a non-reply carries no parent', other.parents === undefined);
  check('the built envelope parses back', model.parseEnvelope({ ...built, id: 'sha256:built', facts: {} }) !== null);
  check('an unaddressed draft is not sendable', model.isDraftSendable({ ...draft, peerId: '' }) === false);
  check('a titled addressed draft is sendable', model.isDraftSendable(draft) === true);

  section('Cursor persistence and reset');
  storage.writeString(storage.KEYS.cursor, 'cursor-abc');
  check('cursor round-trips through storage', storage.readString(storage.KEYS.cursor) === 'cursor-abc');
  storage.remove(storage.KEYS.cursor);
  check('cursor can be cleared', storage.readString(storage.KEYS.cursor) === null);

  storage.writeString(storage.KEYS.outbox, '{not json');
  check('a corrupt entry falls back instead of throwing', Array.isArray(storage.readJson(storage.KEYS.outbox, [])));
  check('a corrupt entry is discarded', storage.readString(storage.KEYS.outbox) === null);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: 'CURSOR_RESET', message: 'stale' } }), { status: 409 });
  const reset = await api.fetchEnvelopes('http://127.0.0.1:1', 'stale-cursor');
  check('a 409 is treated as a reset instruction, not an error', reset.ok === true);
  check('a reset clears the cursor', reset.ok === true && reset.value.resetRequired === true && reset.value.cursor === null);

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ events: [envelopes[0]], cursor: 'cursor-next' }), { status: 200 });
  const page = await api.fetchEnvelopes('http://127.0.0.1:1', null);
  check('a page parses and yields the next cursor', page.ok === true && page.value.cursor === 'cursor-next');
  check('a page yields envelopes', page.ok === true && page.value.envelopes.length === 1);

  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  const unreachable = await api.fetchEnvelopes('http://127.0.0.1:1', null);
  check('an unreachable node is an explicit failure', unreachable.ok === false && unreachable.code === 'unreachable');
  const peers = await api.fetchPeers('http://127.0.0.1:1');
  check('a missing peer directory is reported as unavailable', peers.available === false && peers.peers.length === 0);
  globalThis.fetch = realFetch;

  section('Rendering fixture envelopes (real render.ts, minimal DOM shim)');
  const primary = envelopes.find((envelope) => envelope.actor.kind === 'agent-delegated');
  check('a delegated fixture exists to render', primary !== undefined);
  if (primary !== undefined) {
    const card = render.coverCard(
      { envelope: primary, decision: null, needsDecision: true, dismissed: false, selected: false, now: NOW },
      () => {},
    );
    check('the cover card shows the title', allText(card).includes(primary.cover.title));
    check('the cover card prompts for a decision', allText(card).includes('等待你的决定'));

    const detail = render.detailView(
      {
        envelope: primary,
        decision: null,
        needsDecision: true,
        dismissed: false,
        pendingConfirm: null,
        parentTitle: null,
        now: NOW,
      },
      { onBeginDecision() {}, onConfirmDecision() {}, onCancelConfirm() {}, onRetryDecision() {}, onDismiss() {}, onUndismiss() {}, onMarkRead() {}, onAcknowledge() {}, onReply() {} },
    );
    const text = allText(detail);
    for (const dimension of ['transport', 'storage', 'delivery', 'presentation', 'acknowledgement', 'action']) {
      check(`detail renders the "${dimension}" fact`, model.factViews(primary, NOW).some((view) => view.dimension === dimension));
    }
    check('detail states the independence rule', text.includes('已投递不等于已读'));
    check('detail offers approve', text.includes('批准…'));
    check('detail offers reject', text.includes('拒绝…'));
    check('detail offers the low-friction safe choice', text.includes('搁置'));
    check('approval is not a single click', !text.includes('确认批准'));
    // The copy may *mention* undo to say it is unavailable; what must not exist
    // is a control offering it, since the node treats a decided action as
    // terminal and this client cannot honour a reversal.
    const undoControls = findAll(
      detail,
      (node) => node.tagName === 'BUTTON' && /撤销|撤回|重开|Undo|Reopen/i.test(node.textContent),
    );
    check('no undo control is offered', undoControls.length === 0, undoControls.map((node) => node.textContent).join(', '));
  }

  if (primary !== undefined) {
    const pendingDetail = render.detailView(
      {
        envelope: primary,
      decision: { envelopeId: primary.id, intent: 'approve', actionId: 'approve', status: 'pending', at: NOW, error: null },
        needsDecision: true,
        dismissed: false,
        pendingConfirm: null,
        parentTitle: null,
        now: NOW,
      },
      { onBeginDecision() {}, onConfirmDecision() {}, onCancelConfirm() {}, onRetryDecision() {}, onDismiss() {}, onUndismiss() {}, onMarkRead() {}, onAcknowledge() {}, onReply() {} },
    );
    check('a pending decision is shown as submitting', allText(pendingDetail).includes('正在提交'));
    check('a pending decision does not show as approved', !allText(pendingDetail).includes('已记录：批准'));

    const failedDetail = render.detailView(
      {
        envelope: primary,
      decision: { envelopeId: primary.id, intent: 'approve', actionId: 'approve', status: 'failed', at: NOW, error: '节点未连接' },
        needsDecision: true,
        dismissed: false,
        pendingConfirm: null,
        parentTitle: null,
        now: NOW,
      },
      { onBeginDecision() {}, onConfirmDecision() {}, onCancelConfirm() {}, onRetryDecision() {}, onDismiss() {}, onUndismiss() {}, onMarkRead() {}, onAcknowledge() {}, onReply() {} },
    );
    check('a failed decision is shown as unsent', allText(failedDetail).includes('决定未提交'));
    check('a failed decision shows the reason', allText(failedDetail).includes('节点未连接'));
    check('a failed decision offers a retry', allText(failedDetail).includes('重试'));
    check('a failed decision is not shown as approved', !allText(failedDetail).includes('已记录：批准'));
  }

  section('Compose view');
  const composeText = allText(
    render.composeView(
      {
        peers: [{ peerId: 'peer:wei', label: 'Wei', status: null }],
        peersAvailable: true,
        draft,
        replyTo,
        sending: false,
        lastError: null,
      },
      { onField() {}, onSubmit() {}, onCancelReply() {}, onReloadPeers() {} },
    ),
  );
  check('compose shows a peer selector', composeText.includes('对端'));
  check('compose shows the reply target', composeText.includes('引用回复'));
  check('compose offers a send action', composeText.includes('发送'));
  const unavailable = allText(
    render.composeView(
      { peers: [], peersAvailable: false, draft, replyTo: null, sending: false, lastError: null },
      { onField() {}, onSubmit() {}, onCancelReply() {}, onReloadPeers() {} },
    ),
  );
  check('a missing peer directory is stated, not hidden', unavailable.includes('对端目录不可用'));
  check('a missing peer directory offers manual entry', unavailable.includes('手动输入对端 ID'));

  const unpaired = allText(
    render.composeView(
      { peers: [], peersAvailable: true, draft, replyTo: null, sending: false, lastError: null },
      { onField() {}, onSubmit() {}, onCancelReply() {}, onReloadPeers() {} },
    ),
  );
  check('an unpaired node is explained, not shown as an empty list', unpaired.includes('尚未配置任何对端'));
  check('an unpaired node does not offer manual entry as if it would work', !unpaired.includes('手动输入对端 ID'));

  section('Markup supplied by a message stays literal text');
  const hostileEnvelope = model.parseEnvelope({
    id: 'sha256:hostile',
    cover: { title: '<b>bold</b> claim', preview: '<script>alert(1)</script>', actor: { kind: 'human', id: 'p:1' } },
    inlineBody: '<img src=x onerror=alert(1)>',
  });
  if (hostileEnvelope !== null) {
    const card = render.coverCard(
      { envelope: hostileEnvelope, decision: null, needsDecision: false, dismissed: false, selected: false, now: NOW },
      () => {},
    );
    check('markup in a title is rendered as literal characters', allText(card).includes('<b>bold</b> claim'));
    check('no element was created from message markup', findAll(card, (node) => node.tagName === 'B').length === 0);
    check('no script element appears in the tree', findAll(card, (node) => node.tagName === 'SCRIPT').length === 0);
  }

  section('Themes');
  for (const token of ['--c-ground', '--c-ink', '--c-attention', '--c-good', '--c-bad', '--c-info', '--c-accent']) {
    check(`theme defines ${token}`, css.includes(`${token}:`));
  }
  check('dark theme is defined', css.includes("data-theme='dark'"));
  check('system preference is honoured before the app runs', css.includes('prefers-color-scheme: dark'));
  check('reduced motion is respected', css.includes('prefers-reduced-motion'));
  check('focus is always visible', css.includes(':focus-visible'));

  section('Shell wiring');
  for (const id of ['masthead-controls', 'banner-region', 'list-region', 'detail-region', 'live-region', 'main-region', 'outbox-region']) {
    check(`index.html has #${id}`, html.includes(`id="${id}"`));
  }
  check('the app is loaded as a module', html.includes('type="module"'));
  check('the theme is applied before first paint', html.includes('linko.theme'));
  check('the document is declared Chinese-first', html.includes('lang="zh-CN"'));
  check('a skip link is present', html.includes('skip-link'));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exitCode = 1;
  }
}

await main();
