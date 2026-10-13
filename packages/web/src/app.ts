/**
 * Linko inbox — application wiring.
 *
 * Behavioural intent, stated once so the code can be read against it:
 *
 *   Fogg — one prompt at a time. Exactly one envelope is focused, one primary
 *   button is offered, and "Next decision" always leads to the next thing that
 *   actually needs a person. Progress is counted and shown.
 *
 *   Fogg — the safe choice is the cheap one. Defer is a single click, has no
 *   side effects, and is private to this device. Approval costs an extra
 *   deliberate step, because it is the one that grants authority.
 *
 *   About Face — direct manipulation and immediate feedback. Acting on an
 *   envelope updates the list, the facts and the progress at once; the
 *   consequence is stated in plain words rather than implied.
 *
 *   About Face — reversible actions. A decision can be undone while a reversal
 *   is still truthful; once execution has started or its outcome is unknown,
 *   the control is withdrawn and the reason is shown instead.
 */

import { configFromEnvironment, fetchEnvelopes, fetchNode, postDecision, rememberApiBase, type ApiConfig, type NodeInfo } from './api.js';
import { fixtureEnvelopes } from './fixtures.js';
import {
  currentDecision,
  deriveActionState,
  durabilityOf,
  needsDecision,
  nextUndecided,
  recordDecision,
  summarize,
  type DecisionKind,
  type DecisionLedger,
  type Envelope,
} from './model.js';
import {
  banner,
  connectionPill,
  coverCard,
  detailView,
  emptyDetail,
  h,
  liveRegion,
  progressBar,
  themeButton,
  type DetailHandlers,
} from './render.js';

type Connection = 'checking' | 'online' | 'offline';
type Theme = 'light' | 'dark';

interface SyncNote {
  readonly status: 'local' | 'sent' | 'failed';
  readonly detail: string;
}

interface State {
  config: ApiConfig;
  connection: Connection;
  node: NodeInfo | null;
  source: 'node' | 'fixtures';
  envelopes: Envelope[];
  skipped: number;
  ledger: DecisionLedger;
  selectedId: string | null;
  pendingConfirm: 'approve' | 'reject' | null;
  sync: Map<string, SyncNote>;
  theme: Theme;
  toast: string | null;
}

const THEME_KEY = 'linko.theme';

function readTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // Fall through to the system preference.
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme choice is a convenience; failing to remember it is not an error.
  }
}

const state: State = {
  config: configFromEnvironment(window.location.search),
  connection: 'checking',
  node: null,
  source: 'fixtures',
  envelopes: [],
  skipped: 0,
  ledger: {},
  selectedId: null,
  pendingConfirm: null,
  sync: new Map(),
  theme: readTheme(),
  toast: null,
};

const dom = {
  masthead: requireElement('masthead-controls'),
  banner: requireElement('banner-region'),
  list: requireElement('list-region'),
  detail: requireElement('detail-region'),
  live: requireElement('live-region'),
};

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`The inbox shell is missing #${id}.`);
  return element;
}

/* ------------------------------------------------------------------ *
 * Data loading
 * ------------------------------------------------------------------ */

async function load(): Promise<void> {
  const { base } = state.config;
  const node = await fetchNode(base);

  if (node === null) {
    state.connection = 'offline';
    state.source = 'fixtures';
    state.node = null;
    state.envelopes = fixtureEnvelopes(Date.now());
    state.skipped = 0;
    selectDefault();
    render();
    return;
  }

  state.node = node;
  try {
    const result = await fetchEnvelopes(base, null);
    state.envelopes = result.envelopes;
    state.skipped = result.skipped;
    state.source = 'node';
    state.connection = 'online';
  } catch (error) {
    state.connection = 'offline';
    state.source = 'fixtures';
    state.envelopes = fixtureEnvelopes(Date.now());
    state.skipped = 0;
    state.toast = error instanceof Error ? error.message : 'Sync failed.';
  }
  selectDefault();
  render();
}

function selectDefault(): void {
  const first = nextUndecided(state.envelopes, state.ledger, Date.now()) ?? state.envelopes[0] ?? null;
  state.selectedId = first === null ? null : first.id;
}

/* ------------------------------------------------------------------ *
 * Decisions
 * ------------------------------------------------------------------ */

async function decide(envelope: Envelope, kind: DecisionKind): Promise<void> {
  const { ledger, record } = recordDecision(state.ledger, envelope, kind, Date.now());
  state.ledger = ledger;
  state.pendingConfirm = null;

  const durability = durabilityOf(kind);
  if (durability === 'private-local') {
    state.sync.set(envelope.id, {
      status: 'local',
      detail:
        'Private local note for this session. Nothing about it leaves the device, and the envelope stays open. Nothing is written to disk yet, so a reload clears it.',
    });
    announce(`Deferred “${envelope.cover.title}”. Kept open, nothing sent.`);
    render();
    return;
  }

  state.sync.set(envelope.id, {
    status: 'local',
    detail:
      'Held in this page only. The node is not connected, so nothing has left this device and nothing is written to disk — a reload clears it.',
  });
  announce(kind === 'approve' ? 'Approval recorded locally.' : 'Rejection recorded locally.');
  render();

  if (state.connection !== 'online') return;

  const result = await postDecision(state.config.base, record);
  state.sync.set(envelope.id, {
    status: result.ok ? 'sent' : 'failed',
    detail: result.ok
      ? `${result.detail} Authorization is checked again before anything executes.`
      : `${result.detail} The decision is kept locally and can be retried.`,
  });
  render();
}

function undo(envelope: Envelope): void {
  const { ledger } = recordDecision(state.ledger, envelope, 'reopen', Date.now());
  state.ledger = ledger;
  state.sync.set(envelope.id, {
    status: 'local',
    detail:
      'The earlier decision was superseded by a reversal rather than erased. Like the original, it is held in this page only.',
  });
  announce('Decision reversed.');
  render();
}

let toastTimer: number | undefined;

function announce(message: string): void {
  state.toast = message;
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    render();
  }, 4_000);
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function handlersFor(envelope: Envelope): DetailHandlers {
  return {
    onBeginDecision: (kind) => {
      state.pendingConfirm = kind;
      render();
    },
    onConfirmDecision: (kind) => {
      void decide(envelope, kind);
    },
    onCancelConfirm: () => {
      state.pendingConfirm = null;
      render();
    },
    onDefer: () => {
      void decide(envelope, 'defer');
    },
    onUndo: () => undo(envelope),
  };
}

function renderMasthead(now: number): void {
  const progress = summarize(state.envelopes, state.ledger, now);
  const next = nextUndecided(state.envelopes, state.ledger, now);
  const actionable = progress.decided + progress.deferred + progress.open;

  dom.masthead.replaceChildren(
    progressBar(progress.decided, actionable, progress.open, progress.deferred, progress.percent),
    connectionPill(
      state.connection,
      state.connection === 'online'
        ? `${state.node?.nodeId ?? 'node'} · ${state.config.base}`
        : `${state.config.base} (${state.config.source})`,
    ),
    h(
      'button',
      {
        class: 'btn btn--primary btn--small',
        type: 'button',
        text: 'Next decision →',
        disabled: next === null,
        title: next === null ? 'Nothing is waiting for a decision.' : `Go to “${next.cover.title}”`,
        onclick: () => {
          if (next === null) return;
          state.selectedId = next.id;
          state.pendingConfirm = null;
          render();
        },
      },
    ),
    themeButton(state.theme, () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(state.theme);
      render();
    }),
  );
}

function renderBanner(): void {
  if (state.source === 'node' && state.skipped === 0) {
    dom.banner.replaceChildren();
    return;
  }

  if (state.source === 'node') {
    dom.banner.replaceChildren(
      banner('attention', `The node sent ${state.skipped} envelope(s) this inbox refused to parse.`, [
        'Rejected envelopes are never rendered. They are dropped rather than guessed at.',
      ]),
    );
    return;
  }

  dom.banner.replaceChildren(
    banner('attention', 'Preview mode — showing fixture envelopes.', [
      `No node answered at ${state.config.base} (address from: ${state.config.source}). The inbox is fully usable: covers, facts, and decisions all work.`,
      'Decisions are recorded on this device only. Nothing is sent, and no envelope is rewritten.',
      state.node === null
        ? 'Start a node, or open this page with ?api=http://host:port to point somewhere else.'
        : 'The node answered but sync failed.',
    ]),
  );
}

function renderList(now: number): void {
  const items = state.envelopes.map((envelope) =>
    coverCard(
      {
        envelope,
        actionState: deriveActionState(envelope, state.ledger, now),
        decision: currentDecision(state.ledger, envelope.id),
        needsDecision: needsDecision(envelope, state.ledger, now),
        selected: envelope.id === state.selectedId,
        now,
      },
      (id) => {
        state.selectedId = id;
        state.pendingConfirm = null;
        document.querySelector('.inbox')?.setAttribute('data-pane', 'detail');
        render();
      },
    ),
  );

  // Build the child list first: replaceChildren() stringifies anything that is
  // not a Node, so a bare `null` placeholder would render the word "null".
  const children: (Node | string)[] = [
    h(
      'div',
      { class: 'list-heading' },
      h('h2', { text: 'Inbox' }),
      h('span', { text: state.source === 'node' ? 'from node' : 'fixtures' }),
    ),
    ...items,
  ];
  if (items.length === 0) children.push(h('p', { class: 'detail__id', text: 'No envelopes.' }));
  dom.list.replaceChildren(...children);
}

function renderDetail(now: number): void {
  const envelope = state.envelopes.find((candidate) => candidate.id === state.selectedId) ?? null;
  if (envelope === null) {
    dom.detail.replaceChildren(emptyDetail());
    return;
  }

  const note = state.sync.get(envelope.id);
  const article = detailView(
    {
      envelope,
      ledger: state.ledger,
      actionState: deriveActionState(envelope, state.ledger, now),
      decision: currentDecision(state.ledger, envelope.id),
      needsDecision: needsDecision(envelope, state.ledger, now),
      pendingConfirm: state.pendingConfirm,
      now,
    },
    handlersFor(envelope),
  );

  if (note !== undefined) {
    article.append(
      h(
        'div',
        {
          class: 'decision__status',
          'data-durability': note.status === 'sent' ? 'durable-event' : 'private-local',
          style: 'max-width:var(--measure);margin-top:var(--space-4);border-radius:var(--radius-3);border:1px solid var(--c-line)',
        },
        h('p', { text: note.detail }),
      ),
    );
  }

  dom.detail.replaceChildren(article);
}

function render(): void {
  const now = Date.now();
  renderMasthead(now);
  renderBanner();
  renderList(now);
  renderDetail(now);
  dom.live.replaceChildren(...(state.toast === null ? [] : [liveRegion(state.toast)]));
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

function move(offset: number): void {
  if (state.envelopes.length === 0) return;
  const index = state.envelopes.findIndex((envelope) => envelope.id === state.selectedId);
  const nextIndex = Math.min(Math.max((index === -1 ? 0 : index) + offset, 0), state.envelopes.length - 1);
  state.selectedId = state.envelopes[nextIndex]?.id ?? null;
  state.pendingConfirm = null;
  render();
}

function selected(): Envelope | null {
  return state.envelopes.find((envelope) => envelope.id === state.selectedId) ?? null;
}

window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  const envelope = selected();
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
      const next = nextUndecided(state.envelopes, state.ledger, Date.now());
      if (next !== null) {
        state.selectedId = next.id;
        state.pendingConfirm = null;
        render();
      }
      break;
    }
    case 'a':
      if (envelope !== null && needsDecision(envelope, state.ledger, Date.now())) {
        state.pendingConfirm = 'approve';
        render();
      }
      break;
    case 'r':
      if (envelope !== null && needsDecision(envelope, state.ledger, Date.now())) {
        state.pendingConfirm = 'reject';
        render();
      }
      break;
    case 'd':
      if (envelope !== null && needsDecision(envelope, state.ledger, Date.now())) void decide(envelope, 'defer');
      break;
    case 'u':
      if (envelope !== null && currentDecision(state.ledger, envelope.id) !== null) undo(envelope);
      break;
    case 't':
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(state.theme);
      render();
      break;
    case 'Enter':
      if (state.pendingConfirm !== null) {
        const kind = state.pendingConfirm;
        if (envelope !== null) void decide(envelope, kind);
      } else {
        document.querySelector('.inbox')?.setAttribute('data-pane', 'detail');
      }
      break;
    case 'Escape':
      state.pendingConfirm = null;
      document.querySelector('.inbox')?.setAttribute('data-pane', 'list');
      render();
      break;
    default:
      break;
  }
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

applyTheme(state.theme);
// Only an address the user actually supplied is worth remembering; persisting
// the built-in default would silently relabel it as a stored choice.
if (state.config.source === 'query') rememberApiBase(state.config.base);
state.connection = 'checking';
selectDefault();
render();
void load();

// Keep relative timestamps honest without re-fetching anything.
window.setInterval(() => render(), 60_000);
