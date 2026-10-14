/**
 * Linko inbox — application wiring.
 *
 * Behavioural intent, stated once so the code can be read against it:
 *
 *   Fogg — one prompt at a time. Exactly one envelope is focused, the decision
 *   panel offers one primary button, and "next decision" always leads to the
 *   next thing that actually needs a person. Progress is counted and shown.
 *
 *   Fogg — the safe choice is the cheap one. Dismissing is a single click and
 *   stays on this device. Deciding costs a deliberate second step, because it
 *   is the one that grants or removes authority.
 *
 *   About Face — direct manipulation, immediate feedback, and no action that
 *   cannot be honoured. A decision shows as *pending* until the node accepts
 *   it, and as *failed* when it does not; there is no undo control, because the
 *   node treats a decided action as terminal and offering one would be a lie.
 *
 * Everything remembered across reloads is client-side convenience or client-side
 * state: the node address, the sync cursor, the device id, unsent commands and
 * unacknowledged decisions. None of it is authority.
 */

import {
  configFromEnvironment,
  decisionStateFor,
  fetchEnvelopes,
  fetchNode,
  fetchPeers,
  postReceipt,
  sendEnvelope,
  type ApiConfig,
  type NodeInfo,
} from './api.js';
import { fixtureEnvelopes } from './fixtures.js';
import {
  buildHumanEnvelope,
  currentDecision,
  mergeEnvelopes,
  needsDecision,
  nextUndecided,
  recordDecision,
  sanitizeText,
  settleDecision,
  summarize,
  type ComposeDraft,
  type DecisionIntent,
  type DecisionLedger,
  type Envelope,
  type Peer,
  type SendRecord,
} from './model.js';
import { KEYS, readJson, readString, remove, writeJson, writeString } from './storage.js';
import {
  banner,
  composeView,
  connectionPill,
  coverCard,
  detailView,
  emptyDetail,
  h,
  liveRegion,
  outboxView,
  progressBar,
  themeButton,
  type ComposeHandlers,
  type DetailHandlers,
} from './render.js';

type Connection = 'checking' | 'online' | 'offline';
type Theme = 'light' | 'dark';
type View = 'inbox' | 'compose';

const POLL_HEALTHY_MS = 4_000;
const POLL_MAX_BACKOFF_MS = 30_000;
const TOAST_MS = 4_000;

interface State {
  config: ApiConfig;
  connection: Connection;
  node: NodeInfo | null;
  source: 'node' | 'preview' | 'offline';
  envelopes: Envelope[];
  skipped: number;
  cursor: string | null;
  peers: Peer[];
  peersAvailable: boolean;
  decisions: DecisionLedger;
  dismissed: Set<string>;
  outbox: SendRecord[];
  selectedId: string | null;
  view: View;
  draft: ComposeDraft;
  replyTo: { eventId: string; title: string } | null;
  pendingConfirm: 'approve' | 'reject' | null;
  sending: boolean;
  composeError: string | null;
  syncError: string | null;
  toast: string | null;
  theme: Theme;
  deviceId: string;
  clientId: string;
  pollDelay: number;
  pollTimer: number | undefined;
  polling: boolean;
  flushing: boolean;
}

const EMPTY_DRAFT: ComposeDraft = {
  peerId: '',
  title: '',
  preview: '',
  body: '',
  intent: 'request',
  risk: 'low',
  requiresApproval: false,
};

function freshId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `id:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
  }
}

function loadDeviceId(): string {
  const stored = readString(KEYS.deviceId);
  if (stored !== null) return stored;
  const created = `device:web:${freshId().slice(0, 8)}`;
  writeString(KEYS.deviceId, created);
  return created;
}

function loadTheme(): Theme {
  const stored = readString(KEYS.theme);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  writeString(KEYS.theme, theme);
}

const deviceId = loadDeviceId();

const state: State = {
  config: configFromEnvironment(window.location.search, readString(KEYS.apiBase)),
  connection: 'checking',
  node: null,
  source: 'preview',
  envelopes: [],
  skipped: 0,
  cursor: readString(KEYS.cursor),
  peers: [],
  peersAvailable: false,
  decisions: readJson<DecisionLedger>(KEYS.decisions, {}),
  dismissed: new Set(readJson<string[]>(KEYS.dismissed, [])),
  outbox: readJson<SendRecord[]>(KEYS.outbox, []),
  selectedId: null,
  view: 'inbox',
  draft: { ...EMPTY_DRAFT },
  replyTo: null,
  pendingConfirm: null,
  sending: false,
  composeError: null,
  syncError: null,
  toast: null,
  theme: loadTheme(),
  deviceId,
  clientId: deviceId,
  pollDelay: POLL_HEALTHY_MS,
  pollTimer: undefined,
  polling: false,
  flushing: false,
};

const dom = {
  masthead: requireElement('masthead-controls'),
  banner: requireElement('banner-region'),
  list: requireElement('list-region'),
  detail: requireElement('detail-region'),
  live: requireElement('live-region'),
  main: requireElement('main-region'),
  outbox: requireElement('outbox-region'),
};

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`The inbox shell is missing #${id}.`);
  return element;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

function persist(): void {
  writeJson(KEYS.decisions, state.decisions);
  writeJson(KEYS.outbox, state.outbox);
  writeJson(KEYS.dismissed, [...state.dismissed]);
}

function persistCursor(cursor: string | null): void {
  state.cursor = cursor;
  if (cursor === null) remove(KEYS.cursor);
  else writeString(KEYS.cursor, cursor);
}

/** Keep only the tail of the outbox so storage cannot grow without bound. */
function trimOutbox(): void {
  const keep = 40;
  if (state.outbox.length > keep) state.outbox = state.outbox.slice(-keep);
}

/* ------------------------------------------------------------------ *
 * Polling
 * ------------------------------------------------------------------ */

function scheduleNextPoll(): void {
  if (state.pollTimer !== undefined) window.clearTimeout(state.pollTimer);
  state.pollTimer = window.setTimeout(() => {
    void poll();
  }, state.pollDelay);
}

/**
 * One poll cycle. A visible document polls on a steady cadence; a hidden one
 * backs off, so a background tab does not hammer the node. Errors back off
 * exponentially and are surfaced rather than retried invisibly.
 */
async function poll(): Promise<void> {
  if (state.polling) return;
  state.polling = true;
  try {
    const node = await fetchNode(state.config.base);
    if (node === null) {
      state.connection = 'offline';
      state.node = null;
      state.source = state.source === 'node' ? 'offline' : 'preview';
      if (state.envelopes.length === 0) state.envelopes = fixtureEnvelopes(Date.now());
      state.syncError = `无法连接 ${state.config.base}`;
      state.pollDelay = Math.min(state.pollDelay * 2, POLL_MAX_BACKOFF_MS);
    } else {
      // Fixtures are a preview, never data. The moment a node answers, they are
      // dropped along with any cursor, so the inbox only ever shows real events.
      if (state.source !== 'node') {
        state.envelopes = [];
        persistCursor(null);
        state.skipped = 0;
        state.selectedId = null;
      }
      state.node = node;
      state.connection = 'online';
      state.pollDelay = POLL_HEALTHY_MS;
      await syncOnce();
      await flushOutbox();
      selectDefaultIfUnset();
    }
  } finally {
    state.polling = false;
    render();
    scheduleNextPoll();
  }
}

async function syncOnce(): Promise<void> {
  let outcome = await fetchEnvelopes(state.config.base, state.cursor);

  // A cursor the node no longer honours is an instruction, not an error:
  // drop it and pull from the start exactly once (spec 0005).
  if (outcome.ok && outcome.value.resetRequired) {
    persistCursor(null);
    state.envelopes = [];
    state.selectedId = null;
    state.decisions = {};
    persist();
    outcome = await fetchEnvelopes(state.config.base, null);
  }

  if (!outcome.ok) {
    state.syncError = describeFailure(outcome);
    state.pollDelay = Math.min(state.pollDelay * 2, POLL_MAX_BACKOFF_MS);
    return;
  }

  state.syncError = null;
  state.source = 'node';
  state.skipped = outcome.value.skipped;
  state.envelopes = mergeEnvelopes(state.envelopes, outcome.value.envelopes);
  persistCursor(outcome.value.cursor);
}

/**
 * Retry anything still queued from an earlier session. Each attempt reuses its
 * original commandId, so the node collapses a duplicate rather than creating a
 * second event.
 */
async function flushOutbox(): Promise<void> {
  if (state.flushing || state.connection !== 'online') return;
  state.flushing = true;
  try {
    for (const record of state.outbox.filter((entry) => entry.status === 'queued')) {
      await attemptSend(record.commandId);
    }
  } finally {
    state.flushing = false;
  }
}

function describeFailure(outcome: { code: string; detail: string; status: number | null }): string {
  if (outcome.status === null) return '无法连接本机节点';
  const base = `节点返回 ${outcome.status}${outcome.code === '' ? '' : ` (${outcome.code})`}`;
  return outcome.detail === '' ? base : `${base}：${outcome.detail}`;
}

/* ------------------------------------------------------------------ *
 * Receipts — presentation, read, acknowledgement
 * ------------------------------------------------------------------ */

/** True when this device has already recorded a presentation fact. */
function alreadyPresented(envelope: Envelope): boolean {
  return envelope.facts.devices.some(
    (device) => device.deviceId === state.deviceId && device.presentation !== 'unseen',
  );
}

async function sendReceipt(envelope: Envelope, receiptState: string, successText: string): Promise<void> {
  if (state.connection !== 'online') {
    announce('节点未连接，回执未提交');
    return;
  }
  const outcome = await postReceipt(state.config.base, {
    eventId: envelope.id,
    state: receiptState,
    deviceId: state.deviceId,
  });
  if (!outcome.ok) {
    announce(`${successText}失败：${describeFailure(outcome)}`);
    return;
  }
  // The node's own view of the envelope replaces ours; a receipt never rewrites
  // the envelope, it only adds an observation.
  if (outcome.value.envelope !== null) {
    state.envelopes = mergeEnvelopes(state.envelopes, [outcome.value.envelope]);
  }
  announce(successText);
  render();
}

/**
 * Record that this device rendered an envelope. Called when an envelope is
 * opened, so presentation reflects use rather than being assumed.
 */
function markPresented(envelope: Envelope): void {
  if (state.connection !== 'online' || alreadyPresented(envelope)) return;
  void postReceipt(state.config.base, {
    eventId: envelope.id,
    state: 'presented',
    deviceId: state.deviceId,
  }).then((outcome) => {
    if (outcome.ok && outcome.value.envelope !== null) {
      state.envelopes = mergeEnvelopes(state.envelopes, [outcome.value.envelope]);
      render();
    }
    // A failed presentation receipt is not announced: it changes nothing the
    // reader needs to act on, and the fact simply stays unrecorded.
  });
}

/* ------------------------------------------------------------------ *
 * Decisions — submissions that only the node can settle
 * ------------------------------------------------------------------ */

async function submitDecision(envelope: Envelope, intent: DecisionIntent): Promise<void> {
  const { ledger } = recordDecision(state.decisions, envelope.id, intent, Date.now());
  state.decisions = ledger;
  state.pendingConfirm = null;
  persist();
  announce('正在提交决定…');
  render();

  if (state.connection !== 'online') {
    state.decisions = settleDecision(state.decisions, envelope.id, 'failed', '节点未连接，决定没有提交');
    persist();
    render();
    return;
  }

  const outcome = await postReceipt(state.config.base, {
    eventId: envelope.id,
    state: decisionStateFor(intent),
    actionId: intent,
    deviceId: state.deviceId,
  });

  if (!outcome.ok) {
    state.decisions = settleDecision(state.decisions, envelope.id, 'failed', describeFailure(outcome));
    persist();
    announce('决定未提交');
    render();
    return;
  }

  state.decisions = settleDecision(state.decisions, envelope.id, 'confirmed', null);
  persist();
  if (outcome.value.envelope !== null) {
    state.envelopes = mergeEnvelopes(state.envelopes, [outcome.value.envelope]);
  }
  announce(intent === 'approve' ? '节点已接受批准' : '节点已接受拒绝');
  render();
  // Pull the node's own facts so the action dimension reflects the receipt.
  await syncOnce();
  render();
}

async function retryDecision(envelope: Envelope): Promise<void> {
  const decision = currentDecision(state.decisions, envelope.id);
  if (decision === null) return;
  state.decisions = settleDecision(state.decisions, envelope.id, 'pending', null);
  persist();
  render();
  await submitDecisionAfterRetry(envelope, decision.intent);
}

/** Re-submit without appending a second record: a retry is the same attempt. */
async function submitDecisionAfterRetry(envelope: Envelope, intent: DecisionIntent): Promise<void> {
  const outcome = await postReceipt(state.config.base, {
    eventId: envelope.id,
    state: decisionStateFor(intent),
    actionId: intent,
    deviceId: state.deviceId,
  });
  if (!outcome.ok) {
    state.decisions = settleDecision(state.decisions, envelope.id, 'failed', describeFailure(outcome));
  } else {
    state.decisions = settleDecision(state.decisions, envelope.id, 'confirmed', null);
    if (outcome.value.envelope !== null) {
      state.envelopes = mergeEnvelopes(state.envelopes, [outcome.value.envelope]);
    }
    announce('节点已接受决定');
  }
  persist();
  render();
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

function updateRecord(commandId: string, patch: Partial<SendRecord>): void {
  state.outbox = state.outbox.map((record) =>
    record.commandId === commandId ? { ...record, ...patch, updatedAt: Date.now() } : record,
  );
  trimOutbox();
  persist();
}

async function attemptSend(commandId: string): Promise<void> {
  const record = state.outbox.find((entry) => entry.commandId === commandId);
  if (record === undefined || record.status === 'sent' || record.status === 'sending') return;

  if (state.connection !== 'online') {
    updateRecord(commandId, { status: 'queued', error: '节点未连接，已在本机排队' });
    return;
  }

  updateRecord(commandId, { status: 'sending', error: null });
  render();

  const outcome = await sendEnvelope(state.config.base, {
    peerId: record.peerId,
    envelope: record.envelope,
    clientId: record.clientId,
    commandId: record.commandId,
  });

  if (!outcome.ok) {
    const missing = outcome.status === 404;
    updateRecord(commandId, {
      status: 'failed',
      error: missing
        ? '此节点尚未提供 POST /v1/send，消息没有发出'
        : describeFailure(outcome),
    });
    render();
    return;
  }

  updateRecord(commandId, {
    status: 'sent',
    eventId: outcome.value.eventId,
    nodeDelivery: outcome.value.delivery,
    error: null,
  });
  if (outcome.value.envelope !== null) {
    state.envelopes = mergeEnvelopes(state.envelopes, [outcome.value.envelope]);
    state.selectedId = outcome.value.envelope.id;
  }
  announce(outcome.value.duplicate ? '节点已按 commandId 合并了这条消息' : '消息已发送到本机节点');
  render();
}

async function composeAndQueue(): Promise<void> {
  const draft = state.draft;
  state.composeError = null;

  const envelope = buildHumanEnvelope(draft, {
    nonce: freshId(),
    authorId: state.clientId,
    replyTo: state.replyTo,
    now: Date.now(),
  });

  const record: SendRecord = {
    commandId: freshId(),
    clientId: state.clientId,
    peerId: draft.peerId.trim(),
    envelope,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    parentEventId: state.replyTo?.eventId ?? null,
    title: sanitizeText(draft.title).slice(0, 160),
    status: 'queued',
    eventId: null,
    nodeDelivery: null,
    error: null,
  };

  state.outbox = [...state.outbox, record];
  trimOutbox();
  state.draft = { ...EMPTY_DRAFT, peerId: draft.peerId };
  state.replyTo = null;
  state.view = 'inbox';
  state.sending = true;
  persist();
  announce('已加入本机发件箱');
  render();

  try {
    await attemptSend(record.commandId);
  } finally {
    state.sending = false;
    render();
  }
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/** Re-focus whatever had focus before a re-render replaced the DOM. */
function captureFocus(): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  return active.id === '' ? null : active.id;
}

function restoreFocus(id: string | null): void {
  if (id === null) return;
  const next = document.getElementById(id);
  if (next instanceof HTMLElement) next.focus();
}

let toastTimer: number | undefined;

function announce(message: string): void {
  state.toast = message;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, TOAST_MS);
}

function detailHandlersFor(envelope: Envelope): DetailHandlers {
  return {
    onBeginDecision: (intent) => {
      state.pendingConfirm = intent;
      render();
    },
    onConfirmDecision: (intent) => {
      void submitDecision(envelope, intent);
    },
    onCancelConfirm: () => {
      state.pendingConfirm = null;
      render();
    },
    onRetryDecision: () => {
      void retryDecision(envelope);
    },
    onDismiss: () => {
      state.dismissed.add(envelope.id);
      persist();
      announce('已搁置（仅本机）');
      render();
    },
    onUndismiss: () => {
      state.dismissed.delete(envelope.id);
      persist();
      render();
    },
    onMarkRead: () => {
      void sendReceipt(envelope, 'read', '已记录为已读');
    },
    onAcknowledge: () => {
      void sendReceipt(envelope, 'acknowledged', '已记录确认');
    },
    onReply: () => {
      state.view = 'compose';
      state.replyTo = { eventId: envelope.id, title: envelope.cover.title };
      state.draft = { ...EMPTY_DRAFT, peerId: state.draft.peerId, title: `回复：${envelope.cover.title}`, intent: 'inform' };
      render();
    },
  };
}

function composeHandlers(): ComposeHandlers {
  return {
    onField: (patch) => {
      state.draft = { ...state.draft, ...patch };
      render();
    },
    onSubmit: () => {
      void composeAndQueue();
    },
    onCancelReply: () => {
      state.replyTo = null;
      render();
    },
    onReloadPeers: () => {
      void loadPeers();
    },
  };
}

async function loadPeers(): Promise<void> {
  const directory = await fetchPeers(state.config.base);
  state.peers = directory.peers;
  state.peersAvailable = directory.available;
  render();
}

function renderMasthead(now: number): void {
  const progress = summarize(state.envelopes, state.decisions, state.dismissed, now);
  const next = nextUndecided(state.envelopes, state.decisions, state.dismissed, now);

  dom.masthead.replaceChildren(
    progressBar(progress),
    connectionPill(
      state.connection,
      state.connection === 'online'
        ? `${state.node?.nodeId ?? 'node'} · ${state.config.base}`
        : `${state.config.base}（来源：${state.config.source}）`,
    ),
    h(
      'div',
      { class: 'nav' },
      h('button', {
        class: state.view === 'inbox' ? 'btn btn--small btn--primary' : 'btn btn--small',
        type: 'button',
        text: '收件箱',
        'aria-pressed': state.view === 'inbox' ? 'true' : 'false',
        onclick: () => {
          state.view = 'inbox';
          render();
        },
      }),
      h('button', {
        class: state.view === 'compose' ? 'btn btn--small btn--primary' : 'btn btn--small',
        type: 'button',
        text: '撰写',
        'aria-pressed': state.view === 'compose' ? 'true' : 'false',
        onclick: () => {
          state.view = 'compose';
          if (!state.peersAvailable) void loadPeers();
          render();
        },
      }),
    ),
    h('button', {
      class: 'btn btn--small',
      type: 'button',
      text: '下一个待决',
      disabled: next === null,
      title: next === null ? '没有待处理的决定' : `前往「${next.cover.title}」`,
      onclick: () => {
        if (next === null) return;
        state.selectedId = next.id;
        state.pendingConfirm = null;
        state.view = 'inbox';
        render();
      },
    }),
    themeButton(state.theme, () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(state.theme);
      render();
    }),
  );
}

function renderBanner(): void {
  const retry = h('button', {
    class: 'btn btn--small',
    type: 'button',
    text: '重新连接',
    onclick: () => {
      state.pollDelay = POLL_HEALTHY_MS;
      void poll();
    },
  });

  if (state.connection === 'online') {
    if (state.skipped > 0) {
      dom.banner.replaceChildren(
        banner('attention', `节点发来的 ${state.skipped} 条信封无法解析，已被丢弃。`, [
          '无法解析的信封不会被呈现。宁可丢弃，也不猜测内容。',
        ]),
      );
      return;
    }
    if (state.syncError !== null) {
      dom.banner.replaceChildren(banner('attention', '同步出现错误', [state.syncError], retry));
      return;
    }
    dom.banner.replaceChildren();
    return;
  }

  const preview = state.source === 'preview';
  const lines = preview
    ? [
        `本机节点没有响应 ${state.config.base}（地址来源：${state.config.source}）。`,
        '现在显示的是预览固件数据，不是任何真实节点的内容。决定与发送都需要节点，未连接时不会被记录为成功。',
        '启动节点：pnpm node:start；或用 ?api=http://主机:端口 指向别处。',
      ]
    : [
        `本机节点暂时没有响应 ${state.config.base}。`,
        '下面保留的是最近一次从节点拉取的真实信封；它们可能已经过期。决定与发送会等节点恢复，不会伪造成功。',
        '恢复节点后会自动通过 REST 游标继续同步。',
      ];
  dom.banner.replaceChildren(
    banner('attention', preview ? '未连接节点 · 预览模式' : '节点离线 · 显示缓存', lines, retry),
  );
}

function renderList(now: number): void {
  const items = state.envelopes.map((envelope) =>
    coverCard(
      {
        envelope,
        decision: currentDecision(state.decisions, envelope.id),
        needsDecision: needsDecision(envelope, state.decisions, now),
        dismissed: state.dismissed.has(envelope.id),
        selected: envelope.id === state.selectedId,
        now,
      },
      (id) => {
        state.selectedId = id;
        state.pendingConfirm = null;
        state.view = 'inbox';
        openEnvelope(id);
        render();
      },
    ),
  );

  const children: (Node | string)[] = [
    h(
      'div',
      { class: 'list-heading' },
      h('h2', { text: '收件箱' }),
      h('span', { text: state.source === 'node' ? '来自节点' : state.source === 'offline' ? '节点离线 · 缓存' : '预览数据' }),
    ),
    ...items,
  ];
  if (items.length === 0) {
    children.push(
      h(
        'div',
        { class: 'empty-state' },
        h('p', { text: state.source === 'node' ? '收件箱为空。' : state.source === 'offline' ? '节点离线，暂无缓存信封。' : '尚未连接到节点，也没有预览数据。' }),
        h('p', { class: 'muted-line', text: '收到第一条消息后，封面会出现在这里。' }),
      ),
    );
  }
  dom.list.replaceChildren(...children);
}

/** Opening an envelope is what makes "presented" true for this device. */
function openEnvelope(id: string): void {
  const envelope = state.envelopes.find((candidate) => candidate.id === id);
  if (envelope !== undefined) markPresented(envelope);
}

function renderDetail(now: number): void {
  const envelope = state.envelopes.find((candidate) => candidate.id === state.selectedId) ?? null;
  if (envelope === null) {
    dom.detail.replaceChildren(emptyDetail());
    return;
  }
  const parentId = envelope.parents[0] ?? null;
  const parent = parentId === null ? null : state.envelopes.find((candidate) => candidate.id === parentId) ?? null;

  dom.detail.replaceChildren(
    detailView(
      {
        envelope,
        decision: currentDecision(state.decisions, envelope.id),
        needsDecision: needsDecision(envelope, state.decisions, now),
        dismissed: state.dismissed.has(envelope.id),
        pendingConfirm: state.pendingConfirm,
        parentTitle: parent === null ? null : parent.cover.title,
        now,
      },
      detailHandlersFor(envelope),
    ),
  );
}

function renderCompose(): void {
  dom.main.setAttribute('data-view', state.view);
  if (state.view !== 'compose') {
    dom.detail.replaceChildren();
    return;
  }
  dom.detail.replaceChildren(
    composeView(
      {
        peers: state.peers,
        peersAvailable: state.peersAvailable,
        draft: state.draft,
        replyTo: state.replyTo,
        sending: state.sending,
        lastError: state.composeError,
      },
      composeHandlers(),
    ),
  );
}

function renderOutbox(): void {
  const view = outboxView(state.outbox, (commandId) => {
    void attemptSend(commandId);
  });
  dom.outbox.replaceChildren(...(view === null ? [] : [view]));
}

function render(): void {
  const focusId = captureFocus();
  const now = Date.now();
  applyTheme(state.theme);
  renderMasthead(now);
  renderBanner();
  dom.main.setAttribute('data-view', state.view);
  if (state.view === 'compose') renderCompose();
  else {
    renderList(now);
    renderDetail(now);
  }
  renderOutbox();
  dom.live.replaceChildren(...(state.toast === null ? [] : [liveRegion(state.toast)]));
  restoreFocus(focusId);
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

function move(offset: number): void {
  if (state.envelopes.length === 0) return;
  const index = state.envelopes.findIndex((envelope) => envelope.id === state.selectedId);
  const nextIndex = Math.min(Math.max((index === -1 ? 0 : index) + offset, 0), state.envelopes.length - 1);
  const target = state.envelopes[nextIndex];
  if (target === undefined) return;
  state.selectedId = target.id;
  state.pendingConfirm = null;
  state.view = 'inbox';
  openEnvelope(target.id);
  render();
}

function selected(): Envelope | null {
  return state.envelopes.find((envelope) => envelope.id === state.selectedId) ?? null;
}

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const envelope = selected();
  const now = Date.now();
  switch (event.key) {
    case 'j':
    case 'ArrowDown':
      event.preventDefault();
      move(1);
      break;
    case 'k':
    case 'ArrowUp':
      event.preventDefault();
      move(-1);
      break;
    case 'n': {
      event.preventDefault();
      const next = nextUndecided(state.envelopes, state.decisions, state.dismissed, now);
      if (next !== null) {
        state.selectedId = next.id;
        state.pendingConfirm = null;
        state.view = 'inbox';
        openEnvelope(next.id);
        render();
      }
      break;
    }
    case 'a':
      if (envelope !== null && needsDecision(envelope, state.decisions, now)) {
        state.pendingConfirm = 'approve';
        render();
      }
      break;
    case 'r':
      if (envelope !== null && needsDecision(envelope, state.decisions, now)) {
        state.pendingConfirm = 'reject';
        render();
      }
      break;
    case 'd':
      if (envelope !== null) {
        state.dismissed.add(envelope.id);
        persist();
        render();
      }
      break;
    case 'm':
      if (envelope !== null) void sendReceipt(envelope, 'read', '已记录为已读');
      break;
    case 'c':
      event.preventDefault();
      state.view = 'compose';
      if (!state.peersAvailable) void loadPeers();
      render();
      break;
    case 't':
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(state.theme);
      render();
      break;
    case 'Enter':
      if (state.pendingConfirm !== null && envelope !== null) {
        void submitDecision(envelope, state.pendingConfirm);
      }
      break;
    case 'Escape':
      state.pendingConfirm = null;
      state.view = 'inbox';
      render();
      break;
    default:
      break;
  }
});

document.addEventListener('visibilitychange', () => {
  // Coming back to the tab should not wait out a long backoff.
  if (!document.hidden) {
    state.pollDelay = POLL_HEALTHY_MS;
    void poll();
  }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

applyTheme(state.theme);
if (state.config.source === 'query') writeString(KEYS.apiBase, state.config.base);
selectDefault();
render();
void poll();
void loadPeers();

function selectDefault(): void {
  const first =
    nextUndecided(state.envelopes, state.decisions, state.dismissed, Date.now()) ?? state.envelopes[0] ?? null;
  state.selectedId = first === null ? null : first.id;
}

function selectDefaultIfUnset(): void {
  if (state.selectedId !== null) return;
  selectDefault();
}
