#!/usr/bin/env node
/**
 * Smoke check for the built inbox.
 *
 * This is deliberately more than "the files exist". It runs the same compiled
 * modules the browser loads and asserts the properties the UI is supposed to
 * hold:
 *
 *   - fixtures survive the same validator that network input passes through;
 *   - delivery, read, acknowledgement and action stay independent under change;
 *   - an autonomous Agent envelope is never labelled human;
 *   - a decision is reversible while a reversal is truthful, and refused after;
 *   - deferral stays private and does not move the protocol state;
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
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
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
 * tracked so that a `//` inside a URL does not swallow the rest of the line.
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
    // state === 'string'
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

async function main() {
  section('Build output');
  const required = ['index.html', 'theme.css', 'app.js', 'model.js', 'fixtures.js', 'render.js', 'api.js'];
  for (const file of required) {
    check(`dist/${file} exists`, await exists(join(dist, file)));
  }
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
  const cssImport = /@import\s+(?:url\()?["']?(?:https?:)?\/\//i;
  const cssAbsoluteUrl = /url\(\s*["']?(?:https?:)?\/\//i;
  check('index.html loads no remote asset', !absoluteAsset.test(html));
  check('theme.css imports nothing remotely', !cssImport.test(css));
  check('theme.css references no remote asset', !cssAbsoluteUrl.test(css));
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
    const offenders = [...scripts.entries()]
      .filter(([, source]) => pattern.test(stripComments(source)))
      .map(([name]) => name);
    check(`no ${label}`, offenders.length === 0, offenders.join(', '));
  }

  section('Fixtures pass the same validator as network input');
  const model = await import(pathToFileURL(join(dist, 'model.js')).href);
  const fixtures = await import(pathToFileURL(join(dist, 'fixtures.js')).href);
  const NOW = 1_700_000_000_000;
  const envelopes = fixtures.fixtureEnvelopes(NOW);
  check('fixtures render at all', envelopes.length >= 6, `got ${envelopes.length}`);
  check(
    'every fixture round-trips through parseEnvelope',
    envelopes.every((envelope) => model.parseEnvelope(JSON.parse(JSON.stringify(envelope))) !== null),
  );

  const hostile = model.parseEnvelope({
    id: 'sha256:x',
    cover: {
      title: 'ok‮gnp.exe',
      preview: 'x'.repeat(900),
      actor: { kind: 'not-a-kind', id: 'a'.repeat(400) },
    },
    inlineBody: '<img src=x onerror=alert(1)>',
    semantic: { intent: 'nonsense', contextRefs: 'not-an-array' },
    extra: { ignored: true },
  });
  check('unknown actor kind is not trusted', hostile?.actor.kind === 'system');
  check('unknown intent falls back safely', hostile?.semantic.intent === 'inform');
  check('non-array refs are dropped', hostile?.semantic.contextRefs.length === 0);
  check('bidi override is stripped from titles', !hostile?.cover.title.includes('‮'));
  check('over-long preview is truncated', (hostile?.cover.preview.length ?? 0) <= 400);
  check(
    'markup in a body is kept as text, not markup',
    hostile?.inlineBody === '<img src=x onerror=alert(1)>',
    'the value is preserved verbatim; the view layer is responsible for never interpreting it',
  );

  section('Delivery, read, acknowledgement and action stay independent');
  const base = envelopes[0];
  const withRead = {
    ...base,
    facts: {
      ...base.facts,
      devices: base.facts.devices.map((device) => ({ ...device, presentation: 'read' })),
    },
  };
  const factsOf = (envelope) => model.factViews(envelope, {}, NOW);
  const valueOf = (views, dimension) => views.find((view) => view.dimension === dimension)?.value;
  const before = factsOf(base);
  const after = factsOf(withRead);
  check(
    'marking a device read does not change the delivery fact',
    valueOf(before, 'Delivery') === valueOf(after, 'Delivery'),
  );
  check(
    'marking a device read does not change the acknowledgement fact',
    valueOf(before, 'Acknowledgement') === valueOf(after, 'Acknowledgement'),
  );
  check(
    'marking a device read does not change the action fact',
    valueOf(before, 'Action attempt') === valueOf(after, 'Action attempt'),
  );
  check('delivery is reported independently', valueOf(before, 'Delivery') !== undefined);
  check('action is reported independently', valueOf(before, 'Action attempt') !== undefined);
  check(
    'per-device presentation never claims every device without evidence',
    model.presentationSummary([{ deviceId: 'a', label: 'A', presentation: 'read' }, { deviceId: 'b', label: 'B', presentation: 'unseen' }]).value ===
      'Read on 1 of 2',
  );
  check(
    'read on every device is only claimed when every device says so',
    model
      .presentationSummary([
        { deviceId: 'a', label: 'A', presentation: 'read' },
        { deviceId: 'b', label: 'B', presentation: 'read' },
      ])
      .value === 'Read on all 2',
  );

  section('Approval and acknowledgement never follow from reading');
  const unread = { ...base, facts: { ...base.facts, acknowledgement: 'absent', action: 'requested' } };
  const read = { ...unread, facts: { ...unread.facts, devices: unread.facts.devices.map((d) => ({ ...d, presentation: 'read' })) } };
  const readAction = model.deriveActionState(read, {}, NOW);
  check('reading does not approve an action', readAction !== 'approved');

  section('Authorship is distinguishable and autonomous is never human');
  const kinds = ['human', 'agent-delegated', 'agent-autonomous', 'system'];
  const views = kinds.map((kind) => model.authorshipView(kind));
  check('four authorship labels are distinct', new Set(views.map((view) => view.label)).size === 4);
  check('four authorship marks are distinct', new Set(views.map((view) => view.mark)).size === 4);
  check('autonomous is flagged as not human', model.authorshipView('agent-autonomous').notHuman === true);
  check('delegated is flagged as not human', model.authorshipView('agent-delegated').notHuman === true);
  check('human is not flagged as not human', model.authorshipView('human').notHuman === false);

  section('Decision state machine');
  const target = envelopes.find((envelope) => model.needsDecision(envelope, {}, NOW));
  check('at least one fixture is waiting for a decision', target !== undefined);
  if (target !== undefined) {
    const approved = model.recordDecision({}, target, 'approve', NOW);
    check('approval becomes the action state', model.deriveActionState(target, approved.ledger, NOW) === 'approved');
    check('approval is durable work, not a private note', model.durabilityOf('approve') === 'durable-event');
    check('an approved action can still be reversed', model.canReverse('approved') === true);

    const reopened = model.recordDecision(approved.ledger, target, 'reopen', NOW + 1);
    check(
      'reversal is recorded rather than erasing history',
      reopened.ledger[target.id].length === 2 && model.currentDecision(reopened.ledger, target.id).kind === 'reopen',
    );
    check(
      'reversal returns the envelope to needing a decision',
      model.needsDecision(target, reopened.ledger, NOW + 1) === true,
    );

    const deferred = model.recordDecision({}, target, 'defer', NOW);
    check('deferral is a private local fact', model.durabilityOf('defer') === 'private-local');
    check(
      'deferral leaves the action state alone',
      model.deriveActionState(target, deferred.ledger, NOW) === model.deriveActionState(target, {}, NOW),
    );
    check(
      'deferral does not count as a decided item',
      model.summarize([target], deferred.ledger, NOW).decided === 0,
    );

    check('an executing action cannot be reversed', model.canReverse('executing') === false);
    check('a succeeded action cannot be reversed', model.canReverse('succeeded') === false);
    check('an uncertain outcome cannot be reversed', model.canReverse('uncertain') === false);
  }

  const progress = model.summarize(envelopes, {}, NOW);
  check('open count matches the fixtures awaiting a decision', progress.open >= 1, `open=${progress.open}`);
  check('progress starts with nothing decided', progress.decided === 0);

  const expiredFixture = envelopes.find((envelope) => envelope.cover.status === 'expired');
  check('an expired fixture exists', expiredFixture !== undefined);
  if (expiredFixture !== undefined) {
    check('expiry overrides a pending approval', model.deriveActionState(expiredFixture, {}, NOW) === 'expired');
    check('an expired request is not awaiting a decision', model.needsDecision(expiredFixture, {}, NOW) === false);
  }

  section('Rendering fixture envelopes (real render.ts, minimal DOM shim)');
  // A hand-rolled stand-in for the handful of DOM APIs render.ts touches. It
  // exists so the actual view code runs here: textContent is stored as text
  // children, so anything a message supplies stays inert by construction.
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

  globalThis.document = {
    createElement: (tagName) => new FakeNode(tagName),
    createTextNode: (data) => new FakeText(String(data)),
  };

  const render = await import(pathToFileURL(join(dist, 'render.js')).href);

  function allText(node) {
    return node.textContent;
  }

  function findAll(node, predicate, found = []) {
    if (predicate(node)) found.push(node);
    for (const child of node.childNodes ?? []) findAll(child, predicate, found);
    return found;
  }

  const primary = envelopes.find((envelope) => envelope.actor.kind === 'agent-delegated');
  check('a delegated fixture exists to render', primary !== undefined);
  if (primary !== undefined) {
    const card = render.coverCard(
      { envelope: primary, actionState: 'awaiting_approval', decision: null, needsDecision: true, selected: false, now: NOW },
      () => {},
    );
    const cardText = allText(card);
    check('the cover card shows the title', cardText.includes(primary.cover.title));
    check('the cover card shows the authorship label', cardText.includes('Agent · delegated'));
    check('the cover card prompts for a decision', cardText.includes('Needs your decision'));
    check('the cover card carries the delegated mark', findAll(card, (node) => node.getAttribute?.('data-kind') === 'agent-delegated').length === 1);

    const detail = render.detailView(
      {
        envelope: primary,
        ledger: {},
        actionState: 'awaiting_approval',
        decision: null,
        needsDecision: true,
        pendingConfirm: null,
        now: NOW,
      },
      { onBeginDecision: () => {}, onConfirmDecision: () => {}, onCancelConfirm: () => {}, onDefer: () => {}, onUndo: () => {} },
    );
    const detailText = allText(detail);
    for (const dimension of ['Transport attempt', 'Recipient storage', 'Delivery', 'Presentation', 'Acknowledgement', 'Action attempt']) {
      check(`detail renders the "${dimension}" fact`, detailText.includes(dimension));
    }
    check('detail never claims every device was read', !detailText.includes('Read on all'));
    check('detail states the independence rule', detailText.includes('delivered never means read'));
    check('an open decision offers approve', detailText.includes('Approve…'));
    check('an open decision offers reject', detailText.includes('Reject…'));
    check('an open decision offers the low-friction safe choice', detailText.includes('Defer'));
    check('approval is not a single click', !allText(detail).includes('Confirm approval'));
    check('the body object is shown as an inert reference, not fetched', detailText.includes('sha256:') || primary.bodyObjectId === null);
  }

  const autonomous = envelopes.find((envelope) => envelope.actor.kind === 'agent-autonomous');
  if (autonomous !== undefined) {
    const card = render.coverCard(
      { envelope: autonomous, actionState: 'requested', decision: null, needsDecision: true, selected: false, now: NOW },
      () => {},
    );
    check('an autonomous envelope shows its own mark', allText(card).includes('Agent · autonomous'));
    const detail = render.detailView(
      {
        envelope: autonomous,
        ledger: {},
        actionState: 'requested',
        decision: null,
        needsDecision: true,
        pendingConfirm: null,
        now: NOW,
      },
      { onBeginDecision: () => {}, onConfirmDecision: () => {}, onCancelConfirm: () => {}, onDefer: () => {}, onUndo: () => {} },
    );
    check('an autonomous envelope is explicitly not human-authored', allText(detail).includes('must never be shown as human-authored'));
  }

  // The confirmation step must appear only after the deliberate first click.
  if (primary !== undefined) {
    const confirming = render.detailView(
      {
        envelope: primary,
        ledger: {},
        actionState: 'awaiting_approval',
        decision: null,
        needsDecision: true,
        pendingConfirm: 'approve',
        now: NOW,
      },
      { onBeginDecision: () => {}, onConfirmDecision: () => {}, onCancelConfirm: () => {}, onDefer: () => {}, onUndo: () => {} },
    );
    check('the confirmation step appears once approval is chosen', allText(confirming).includes('Confirm approval'));
    check('the confirmation names what the approval binds to', allText(confirming).includes(primary.id));
    check('the confirmation offers a way back', allText(confirming).includes('Cancel'));
  }

  // Markup supplied by a message stays literal text in the rendered tree.
  const hostileEnvelope = model.parseEnvelope({
    id: 'sha256:hostile',
    cover: { title: '<b>bold</b> claim', preview: '<script>alert(1)</script>', actor: { kind: 'human', id: 'p:1' } },
    inlineBody: '<img src=x onerror=alert(1)>',
  });
  if (hostileEnvelope !== null) {
    const card = render.coverCard(
      { envelope: hostileEnvelope, actionState: 'requested', decision: null, needsDecision: false, selected: false, now: NOW },
      () => {},
    );
    const text = allText(card);
    check('markup in a title is rendered as literal characters', text.includes('<b>bold</b> claim'));
    check('no element was created from message markup', findAll(card, (node) => node.tagName === 'B').length === 0);
    check('no script element appears in the tree', findAll(card, (node) => node.tagName === 'SCRIPT').length === 0);
  }

  delete globalThis.document;

  section('Themes');
  for (const token of ['--c-ground', '--c-ink', '--c-attention', '--c-good', '--c-bad', '--c-info', '--c-accent']) {
    check(`theme defines ${token}`, css.includes(`${token}:`));
  }
  check('light theme is defined', /data-theme='light'/.test(css) || /data-theme="light"/.test(css) || css.includes(':root,'));
  check('dark theme is defined', css.includes("data-theme='dark'"));
  check('system preference is honoured before the app runs', css.includes('prefers-color-scheme: dark'));
  check('reduced motion is respected', css.includes('prefers-reduced-motion'));

  section('Shell wiring');
  for (const id of ['masthead-controls', 'banner-region', 'list-region', 'detail-region', 'live-region']) {
    check(`index.html has #${id}`, html.includes(`id="${id}"`));
  }
  check('the app is loaded as a module', html.includes('type="module"'));
  check('the theme is applied before first paint', html.includes('linko.theme'));

  console.log(`\n${checks - failures}/${checks} checks passed.`);
  if (failures > 0) {
    console.error(`${failures} check(s) failed.`);
    process.exitCode = 1;
  }
}

await main();
