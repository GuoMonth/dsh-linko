/**
 * DOM construction.
 *
 * Every element is built with `createElement` and every value is written with
 * `textContent`. The package contains no markup-string sinks at all: no
 * inner-markup assignment properties, no adjacent-markup insertion, no
 * document-writing call, no eval, and no Function-constructor use. A message
 * body, title, or reference can therefore only ever appear as inert text —
 * remote HTML and JavaScript are data, never authority
 * (docs/specs/0002-message-envelope.md).
 *
 * `scripts/smoke.mjs` asserts that property against the emitted bundle.
 */

import {
  actionLabel,
  authorshipView,
  canReverse,
  factViews,
  formatClock,
  presentationSummary,
  riskTone,
  type ActionState,
  type DecisionLedger,
  type DecisionRecord,
  type Envelope,
  type FactView,
  type Tone,
} from './model.js';

type Child = Node | string | null | undefined;

type Props = Record<string, string | number | boolean | EventListener | null | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Like `h`, but for appending to an existing node; skips absent children. */
function append(node: Element, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

function chip(label: string, tone: Tone = 'neutral', extraClass = ''): HTMLElement {
  return h('span', { class: `chip ${extraClass}`.trim(), 'data-tone': tone, text: label });
}

function authorshipMark(kind: Envelope['actor']['kind']): HTMLElement {
  const view = authorshipView(kind);
  return h('span', {
    class: 'mark',
    'data-kind': kind,
    text: view.mark,
    title: view.label,
    'aria-hidden': 'true',
  });
}

/* ------------------------------------------------------------------ *
 * Cover card
 * ------------------------------------------------------------------ */

export interface CoverCardModel {
  readonly envelope: Envelope;
  readonly actionState: ActionState;
  readonly decision: DecisionRecord | null;
  readonly needsDecision: boolean;
  readonly selected: boolean;
  readonly now: number;
}

function coverTone(model: CoverCardModel): Tone {
  if (model.decision?.kind === 'approve') return 'good';
  if (model.decision?.kind === 'reject') return 'bad';
  if (model.actionState === 'expired') return 'bad';
  if (model.actionState === 'uncertain') return 'attention';
  if (model.needsDecision) return 'attention';
  if (model.actionState === 'succeeded') return 'good';
  return 'neutral';
}

export function coverCard(model: CoverCardModel, onSelect: (id: string) => void): HTMLElement {
  const { envelope } = model;
  const authorship = authorshipView(envelope.actor.kind);

  const statusChip =
    model.decision?.kind === 'approve'
      ? chip('Approved', 'good')
      : model.decision?.kind === 'reject'
        ? chip('Rejected', 'bad')
        : model.decision?.kind === 'defer'
          ? chip('Deferred', 'muted')
          : model.needsDecision
            ? chip('Needs your decision', 'attention')
            : model.actionState === 'expired'
              ? chip('Expired', 'bad')
              : chip(envelope.semantic.intent, 'neutral');

  return h(
    'button',
    {
      class: 'cover-card',
      type: 'button',
      'data-tone': coverTone(model),
      'data-decision': model.decision?.kind ?? 'none',
      'aria-current': model.selected ? 'true' : 'false',
      onclick: () => onSelect(envelope.id),
    },
    h(
      'div',
      { class: 'cover-card__top' },
      authorshipMark(envelope.actor.kind),
      h(
        'div',
        { style: 'min-width:0;flex:1' },
        h('h3', { class: 'cover-card__title', text: envelope.cover.title }),
        envelope.cover.preview === ''
          ? null
          : h('p', { class: 'cover-card__preview', text: envelope.cover.preview }),
      ),
    ),
    h(
      'div',
      { class: 'cover-card__meta' },
      statusChip,
      chip(authorship.label, authorship.tone === 'attention' ? 'attention' : 'muted'),
      envelope.policy.risk === 'high' ? chip('High risk', 'bad') : null,
      h('span', {
        class: 'chip',
        'data-tone': 'muted',
        text: formatClock(envelope.receivedAt, model.now),
      }),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Detail
 * ------------------------------------------------------------------ */

export interface DetailModel {
  readonly envelope: Envelope;
  readonly ledger: DecisionLedger;
  readonly actionState: ActionState;
  readonly decision: DecisionRecord | null;
  readonly needsDecision: boolean;
  readonly pendingConfirm: 'approve' | 'reject' | null;
  readonly now: number;
}

export interface DetailHandlers {
  readonly onBeginDecision: (kind: 'approve' | 'reject') => void;
  readonly onConfirmDecision: (kind: 'approve' | 'reject') => void;
  readonly onCancelConfirm: () => void;
  readonly onDefer: () => void;
  readonly onUndo: () => void;
}

/** An envelope reference is a pointer, not a delivery guarantee — never fetch or render it. */
function inertReference(label: string, value: string, explanation: string): HTMLElement {
  return h(
    'div',
    { class: 'inert' },
    h('span', { text: `${label} ` }),
    h('code', { text: value }),
    h('span', { text: ` — ${explanation}` }),
  );
}

function factCard(fact: FactView): HTMLElement {
  return h(
    'div',
    { class: 'fact', 'data-tone': fact.tone },
    h('div', { class: 'fact__dimension', text: fact.dimension }),
    h('div', { class: 'fact__value', text: fact.value }),
    h('p', { class: 'fact__note', text: fact.note }),
  );
}

function decisionPanel(model: DetailModel, handlers: DetailHandlers): HTMLElement {
  const { envelope, actionState, decision, needsDecision, pendingConfirm } = model;
  const irreversible = !canReverse(actionState);

  // Already decided (or resolved elsewhere): report the outcome and what can be undone.
  if (decision !== null || !needsDecision) {
    const status = h('div', {
      class: 'decision__status',
      'data-durability': decision === null ? 'durable-event' : decision.kind === 'defer' ? 'private-local' : 'durable-event',
    });

    if (decision?.kind === 'approve' || decision?.kind === 'reject') {
      const reversible = canReverse(actionState);
      append(
        status,
        h('p', {
          text:
            decision.kind === 'approve'
              ? 'Approval recorded against this envelope. It binds the message digest, action, audience and policy version.'
              : 'Rejection recorded against this envelope. The request will not be executed by this device.',
        }),
        reversible
          ? h('button', {
              class: 'btn btn--small',
              type: 'button',
              text: 'Undo',
              onclick: handlers.onUndo,
            })
          : null,
        reversible
          ? null
          : h('span', {
              class: 'chip',
              'data-tone': 'bad',
              text: 'Cannot be reversed',
            }),
      );
      if (!reversible) {
        status.setAttribute('data-durability', 'irreversible');
      }
    } else if (decision?.kind === 'defer') {
      status.append(
        h('p', {
          text: 'Deferred. This is a private local note — nothing about it leaves this device, and the envelope stays open.',
        }),
        h('button', { class: 'btn btn--small', type: 'button', text: 'Undo', onclick: handlers.onUndo }),
      );
    } else if (actionState === 'expired') {
      status.setAttribute('data-durability', 'irreversible');
      status.append(
        h('p', {
          text: 'Policy expired this request before it was approved. Expiry cannot undo an effect that already completed.',
        }),
      );
    } else if (actionState === 'uncertain') {
      status.setAttribute('data-durability', 'irreversible');
      status.append(
        h('p', {
          text: 'The outcome is uncertain: execution started and its result was never recorded. Retry only with a downstream idempotency contract, or reconcile by hand.',
        }),
      );
    } else if (actionState === 'succeeded') {
      status.append(h('p', { text: 'This action already completed. There is nothing left to approve.' }));
    } else {
      status.append(
        h('p', {
          text: 'No approval is required for this envelope. Informative events may be accepted automatically.',
        }),
      );
    }
    return h('div', { class: 'decision', 'data-state': 'settled' }, status);
  }

  // Open decision. Deliberate approval, and a safe choice that costs one click.
  const body = h('div', { class: 'decision__body' });

  if (pendingConfirm !== null) {
    const approving = pendingConfirm === 'approve';
    body.append(
      h(
        'div',
        { class: 'confirm', 'data-kind': pendingConfirm },
        h('p', {
          class: 'confirm__title',
          text: approving ? 'Confirm approval' : 'Confirm rejection',
        }),
        h('p', {
          class: 'confirm__detail',
          text: approving
            ? `This records an approval for action "${envelope.semantic.availableActions[0] ?? 'approve'}" bound to ${envelope.id}. Authorization is checked again immediately before anything executes, and this preview node is offline, so nothing will run.`
            : `This records a rejection for ${envelope.id}. The sender is told the request was declined; the envelope stays readable.`,
        }),
        h(
          'div',
          { class: 'confirm__actions' },
          h('button', {
            class: approving ? 'btn btn--primary' : 'btn btn--danger',
            type: 'button',
            text: approving ? 'Confirm approval' : 'Confirm rejection',
            onclick: () => handlers.onConfirmDecision(pendingConfirm),
          }),
          h('button', {
            class: 'btn btn--quiet',
            type: 'button',
            text: 'Cancel',
            onclick: handlers.onCancelConfirm,
          }),
        ),
      ),
    );
  } else {
    body.append(
      h('button', {
        class: 'btn btn--primary',
        type: 'button',
        text: 'Approve…',
        onclick: () => handlers.onBeginDecision('approve'),
      }),
      h('button', {
        class: 'btn btn--danger',
        type: 'button',
        text: 'Reject…',
        onclick: () => handlers.onBeginDecision('reject'),
      }),
      h('div', { class: 'decision__spacer' }),
      h('button', {
        class: 'btn btn--quiet',
        type: 'button',
        text: 'Defer',
        title: 'Keeps the envelope open. A private local note; nothing is sent.',
        onclick: handlers.onDefer,
      }),
    );
  }

  return h(
    'div',
    { class: 'decision', 'data-state': 'open' },
    h(
      'div',
      { class: 'decision__head' },
      h('h3', {
        text:
          actionState === 'awaiting_approval'
            ? 'This request is waiting for your approval'
            : 'This request needs a decision',
      }),
      h('p', {
        class: 'decision__prompt',
        text:
          envelope.actor.kind === 'agent-autonomous'
            ? 'An autonomous Agent asked for this. Read the intent and the limits below before approving.'
            : 'Approving records a decision against this exact envelope. Deferring is free and always available.',
      }),
    ),
    body,
  );
}

export function detailView(model: DetailModel, handlers: DetailHandlers): HTMLElement {
  const { envelope, ledger, actionState, now } = model;
  const authorship = authorshipView(envelope.actor.kind);
  const presentation = presentationSummary(envelope.facts.devices);

  const head = h(
    'header',
    { class: 'detail__head' },
    h(
      'div',
      { class: 'detail__eyebrow' },
      authorshipMark(envelope.actor.kind),
      chip(authorship.label, authorship.tone === 'attention' ? 'attention' : 'progress'),
      chip(`intent · ${envelope.semantic.intent}`),
      chip(`risk · ${envelope.policy.risk}`, riskTone(envelope.policy.risk)),
      chip(`action · ${actionLabel(actionState)}`),
    ),
    h('h2', { class: 'detail__title', text: envelope.cover.title }),
    envelope.cover.preview === '' ? null : h('p', { class: 'detail__preview', text: envelope.cover.preview }),
    h('div', { class: 'detail__id', text: envelope.id }),
  );

  // Facts, side by side, with the rule that keeps each one independent.
  const facts = h(
    'section',
    { class: 'section' },
    h('h3', { class: 'section__title', text: 'Independent facts' }),
    h('div', { class: 'facts' }, ...factViews(envelope, ledger, now).map(factCard)),
    h('p', {
      class: 'independence-note',
      text: `Per-device presentation is kept separate: ${presentation.value.toLowerCase()}. These dimensions are never merged into one status — delivered never means read, read never means acknowledged, and an action may occur without read.`,
    }),
  );

  const policyRows = h(
    'div',
    { class: 'rows' },
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: 'Approval' }),
      h('div', {
        class: 'row__value',
        text: envelope.policy.requiresApproval
          ? 'Required before this can execute'
          : 'Not required — informative events may be accepted automatically',
      }),
    ),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: 'Expiry' }),
      h('div', {
        class: 'row__value',
        text:
          envelope.policy.expiresAt === null
            ? 'No expiry set'
            : `${new Date(envelope.policy.expiresAt).toISOString()} (${formatClock(envelope.policy.expiresAt, now)})`,
      }),
    ),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: 'Budgets' }),
      h('div', {
        class: 'row__value',
        text: `hop ≤ ${envelope.policy.hopLimit ?? '—'} · fan-out ≤ ${envelope.policy.fanoutLimit ?? '—'}`,
      }),
    ),
    h(
      'div',
      { class: 'row' },
      h('div', { class: 'row__label', text: 'Authorship' }),
      h(
        'div',
        { class: 'row__value' },
        h('p', { style: 'margin:0 0 6px', text: authorship.detail }),
        authorship.notHuman
          ? h('p', {
              style: 'margin:0',
              text: 'This envelope must never be shown as human-authored.',
            })
          : null,
        envelope.actor.delegatorId === null
          ? null
          : h('p', {
              style: 'margin:6px 0 0',
              class: 'detail__id',
              text: `delegator ${envelope.actor.delegatorId} · composer ${envelope.actor.composerId ?? envelope.actor.id}`,
            }),
      ),
    ),
  );

  const content = h(
    'section',
    { class: 'section' },
    h('h3', { class: 'section__title', text: 'Content and references' }),
    envelope.inlineBody === null
      ? h('p', {
          class: 'row__value row__value--quote',
          text: 'No inline body. The cover is shown on its own, which is the point of the split.',
        })
      : h('div', { class: 'rows' }, h('div', { class: 'row' }, h('div', { class: 'row__label', text: 'Body' }), h('div', { class: 'row__value row__value--quote', text: envelope.inlineBody }))),
    envelope.bodyObjectId === null
      ? null
      : inertReference('Body object', envelope.bodyObjectId, 'fetched only on request, then verified against its hash'),
    envelope.surfaceRef === null
      ? null
      : inertReference(
          'Surface',
          `${envelope.surfaceRef.surfaceId} v${envelope.surfaceRef.version}`,
          'rendered from an allowlisted catalogue; never executed here',
        ),
    envelope.semantic.contextRefs.length === 0
      ? null
      : h(
          'div',
          { class: 'row' },
          h('div', { class: 'row__label', text: 'Context' }),
          h(
            'div',
            { class: 'refs' },
            ...envelope.semantic.contextRefs.map((ref) => chip(ref, 'neutral')),
          ),
        ),
    envelope.semantic.availableActions.length === 0
      ? null
      : h(
          'div',
          { class: 'row' },
          h('div', { class: 'row__label', text: 'Requested actions' }),
          h(
            'div',
            { class: 'refs' },
            ...envelope.semantic.availableActions.map((action) => chip(action, 'progress')),
          ),
        ),
  );

  return h('article', {}, head, facts, h('section', { class: 'section' }, h('h3', { class: 'section__title', text: 'Policy and provenance' }), policyRows), content, decisionPanel(model, handlers));
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

export function emptyDetail(): HTMLElement {
  return h(
    'div',
    { class: 'detail__empty' },
    h('h2', { text: 'Nothing selected' }),
    h('p', { text: 'Choose an envelope cover to read it. Bodies are fetched only when you ask.' }),
  );
}

export function connectionPill(state: 'online' | 'offline' | 'checking', label: string): HTMLElement {
  return h(
    'div',
    { class: 'connection', 'data-state': state, title: label },
    h('span', { class: 'connection__dot', 'aria-hidden': 'true' }),
    h('span', { text: state === 'online' ? 'Node online' : state === 'checking' ? 'Contacting node' : 'Preview fixtures' }),
    h('span', { class: 'connection__label', text: label }),
  );
}

export function progressBar(decided: number, actionable: number, open: number, deferred: number, percent: number): HTMLElement {
  return h(
    'div',
    { class: 'progress', role: 'group', 'aria-label': 'Decision progress' },
    h('div', { class: 'progress__bar' }, h('div', { class: 'progress__fill', style: `width:${percent}%` })),
    h(
      'span',
      { class: 'progress__text' },
      h('strong', { text: `${decided}/${actionable}` }),
      ' decided',
      open > 0 ? ` · ${open} open` : ' · all clear',
      deferred > 0 ? ` · ${deferred} deferred` : '',
    ),
  );
}

export function banner(tone: Tone, title: string, lines: readonly string[]): HTMLElement {
  return h(
    'div',
    { class: 'banner', 'data-tone': tone },
    h(
      'div',
      { class: 'banner__body' },
      h('strong', { text: title }),
      ...lines.map((line) => h('p', { text: line })),
    ),
  );
}

export function liveRegion(message: string): HTMLElement {
  return h('div', { class: 'live', role: 'status', 'aria-live': 'polite', text: message });
}

export function themeButton(theme: 'light' | 'dark', onToggle: () => void): HTMLElement {
  return h('button', {
    class: 'btn btn--small',
    type: 'button',
    text: theme === 'dark' ? '☾ Dark' : '☀ Light',
    title: 'Switch theme',
    'aria-label': `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
    onclick: onToggle,
  });
}
