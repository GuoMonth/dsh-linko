/**
 * Linko inbox — pure domain model.
 *
 * Mirrors docs/specs/0002-message-envelope.md ("Independent delivery and reading
 * facts") and docs/specs/0005-state-and-storage.md ("Separate state dimensions").
 *
 * No DOM, no network, no framework. Every export is a pure function so that
 * scripts/smoke.mjs runs exactly the code the browser runs.
 *
 * Two rules from the specs are enforced structurally here rather than by
 * convention in the view layer:
 *
 *   1. Delivery, read, acknowledgement and action are independent dimensions.
 *      There is no combined status enum, and no derivation may turn one into
 *      another. `delivered` never means read; `read` never means acknowledged;
 *      `acted` may occur without read.
 *   2. An envelope from the network is untrusted input. `parseEnvelope` copies
 *      only known fields, drops everything else, strips control and bidi
 *      characters, and bounds every string, so no remote field can reach the
 *      DOM except as inert text.
 */

/* ------------------------------------------------------------------ *
 * Vocabularies (spec 0002 authorship, spec 0005 state dimensions)
 * ------------------------------------------------------------------ */

export const ACTOR_KINDS = ['human', 'agent-delegated', 'agent-autonomous', 'system'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const INTENTS = ['inform', 'suggest', 'request', 'delegate', 'command'] as const;
export type Intent = (typeof INTENTS)[number];

export const RISKS = ['low', 'medium', 'high'] as const;
export type Risk = (typeof RISKS)[number];

/** Outbound job dimension. Terminals: rejected, abandoned. */
export const OUTBOUND_STATES = ['queued', 'sending', 'confirmed', 'retry_wait', 'rejected', 'abandoned'] as const;
export type OutboundState = (typeof OUTBOUND_STATES)[number];

/** Recipient storage dimension. `accepted` and `usable` are distinct. */
export const STORAGE_STATES = ['unknown', 'accepted', 'dependency_pending', 'usable'] as const;
export type StorageState = (typeof STORAGE_STATES)[number];

/** Recipient inbox dimension. */
export const INBOX_STATES = ['absent', 'delivered'] as const;
export type InboxState = (typeof INBOX_STATES)[number];

/** Human presentation dimension. Per device. */
export const PRESENTATION_STATES = ['unseen', 'presented', 'read'] as const;
export type PresentationState = (typeof PRESENTATION_STATES)[number];

/** Acknowledgement dimension. Never inferred from read. */
export const ACK_STATES = ['absent', 'acknowledged'] as const;
export type AckState = (typeof ACK_STATES)[number];

/** Action attempt dimension, including its own approval and execution. */
export const ACTION_STATES = [
  'requested',
  'awaiting_approval',
  'approved',
  'executing',
  'succeeded',
  'failed',
  'uncertain',
  'rejected',
  'expired',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/** Delegation dimension, checked again when an action starts. */
export const DELEGATION_STATES = ['granted', 'active', 'expired', 'revoked'] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface Actor {
  readonly kind: ActorKind;
  readonly id: string;
  /** Composer, sender and delegator stay separate fields (spec 0002). */
  readonly composerId: string | null;
  readonly delegatorId: string | null;
}

export interface Cover {
  readonly title: string;
  readonly preview: string;
  readonly status: string;
}

export interface Semantic {
  readonly intent: Intent;
  readonly contextRefs: readonly string[];
  readonly availableActions: readonly string[];
}

export interface Policy {
  readonly risk: Risk;
  readonly requiresApproval: boolean;
  readonly expiresAt: number | null;
  readonly hopLimit: number | null;
  readonly fanoutLimit: number | null;
}

export interface DeviceFacts {
  readonly deviceId: string;
  readonly label: string;
  readonly presentation: PresentationState;
}

/**
 * Facts are observations recorded against the envelope. They are held apart
 * from the envelope's own immutable content, and each is optional: an
 * unobserved fact stays `unknown`/`absent` and is never rendered as progress.
 */
export interface EnvelopeFacts {
  readonly outbound: OutboundState;
  readonly storage: StorageState;
  readonly inbox: InboxState;
  readonly acknowledgement: AckState;
  readonly action: ActionState;
  readonly delegation: DelegationState | null;
  readonly devices: readonly DeviceFacts[];
}

export interface Envelope {
  /** `event_id`: hash of the canonical unsigned payload (spec 0005). */
  readonly id: string;
  readonly kind: string;
  readonly cover: Cover;
  readonly actor: Actor;
  readonly semantic: Semantic;
  readonly policy: Policy;
  /** Short content rendered as inert text. Never HTML. */
  readonly inlineBody: string | null;
  readonly bodyObjectId: string | null;
  readonly surfaceRef: { readonly surfaceId: string; readonly version: number } | null;
  readonly facts: EnvelopeFacts;
  readonly receivedAt: number;
}

/* ------------------------------------------------------------------ *
 * Untrusted-input hardening
 * ------------------------------------------------------------------ */

const MAX = {
  id: 200,
  title: 160,
  preview: 400,
  status: 60,
  body: 4000,
  ref: 200,
  refs: 32,
  devices: 64,
  actions: 16,
  kind: 80,
} as const;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_OVERRIDES = /[‪-‮⁦-⁩‎‏]/g;

/**
 * Remove characters that could reorder or corrupt rendered text. Nothing here
 * is an HTML sanitizer: the view layer never interprets markup, so this only
 * protects the plain-text rendering path.
 */
export function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, ' ').replace(BIDI_OVERRIDES, '');
}

function asText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeText(value).trim();
  if (cleaned.length === 0 || cleaned.length > maxLength) return null;
  return cleaned;
}

/** Longer text is truncated rather than rejected, so a chatty peer cannot blank a cover. */
function asLongText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = sanitizeText(value).trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const refs: string[] = [];
  for (const entry of value.slice(0, MAX.refs)) {
    const ref = asText(entry, MAX.ref);
    if (ref !== null) refs.push(ref);
  }
  return refs;
}

function asDevices(value: unknown): DeviceFacts[] {
  if (!Array.isArray(value)) return [];
  const devices: DeviceFacts[] = [];
  for (const entry of value.slice(0, MAX.devices)) {
    const record = asRecord(entry);
    if (record === null) continue;
    const deviceId = asText(record['deviceId'], MAX.id);
    const presentation = asEnum(record['presentation'], PRESENTATION_STATES);
    if (deviceId === null || presentation === null) continue;
    devices.push({ deviceId, label: asText(record['label'], MAX.status) ?? deviceId, presentation });
  }
  return devices;
}

function asTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBoundedInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

/**
 * Narrow one untrusted envelope. Returns null when the envelope lacks the
 * minimum a cover needs; otherwise returns a value built only from copied,
 * bounded fields. Unknown keys are dropped, never forwarded.
 */
export function parseEnvelope(value: unknown): Envelope | null {
  const record = asRecord(value);
  if (record === null) return null;

  const id = asText(record['id'], MAX.id);
  const coverRecord = asRecord(record['cover']);
  if (id === null || coverRecord === null) return null;

  const title = asText(coverRecord['title'], MAX.title);
  if (title === null) return null;

  const actorRecord = asRecord(coverRecord['actor']) ?? asRecord(record['actor']);
  const kind = asEnum(actorRecord?.['kind'], ACTOR_KINDS) ?? 'system';
  const actorId = asText(actorRecord?.['id'], MAX.id) ?? 'unknown';

  const semanticRecord = asRecord(record['semantic']) ?? {};
  const policyRecord = asRecord(record['policy']) ?? {};
  const factsRecord = asRecord(record['facts']) ?? {};
  const bodyRef = asRecord(record['bodyRef']);
  const surfaceRecord = asRecord(record['surfaceRef']);

  return {
    id,
    kind: asText(record['kind'], MAX.kind) ?? 'message',
    cover: {
      title,
      preview: asLongText(coverRecord['preview'], MAX.preview) ?? '',
      status: asText(coverRecord['status'], MAX.status) ?? 'unknown',
    },
    actor: {
      kind,
      id: actorId,
      composerId: asText(actorRecord?.['composerId'], MAX.id),
      delegatorId: asText(actorRecord?.['delegatorId'], MAX.id),
    },
    semantic: {
      intent: asEnum(semanticRecord['intent'], INTENTS) ?? 'inform',
      contextRefs: asRefs(semanticRecord['contextRefs']),
      availableActions: asRefs(semanticRecord['availableActions']).slice(0, MAX.actions),
    },
    policy: {
      risk: asEnum(policyRecord['risk'], RISKS) ?? 'low',
      requiresApproval: policyRecord['requiresApproval'] === true,
      expiresAt: asTimestamp(policyRecord['expiresAt']),
      hopLimit: asBoundedInt(policyRecord['hopLimit']),
      fanoutLimit: asBoundedInt(policyRecord['fanoutLimit']),
    },
    inlineBody: asLongText(record['inlineBody'], MAX.body) ?? asLongText(record['body'], MAX.body),
    bodyObjectId: asText(bodyRef?.['objectId'], MAX.ref),
    surfaceRef: (() => {
      const surfaceId = asText(surfaceRecord?.['surfaceId'], MAX.ref);
      if (surfaceId === null) return null;
      return { surfaceId, version: asBoundedInt(surfaceRecord?.['version']) ?? 0 };
    })(),
    facts: {
      outbound: asEnum(factsRecord['outbound'], OUTBOUND_STATES) ?? 'queued',
      storage: asEnum(factsRecord['storage'], STORAGE_STATES) ?? 'unknown',
      inbox: asEnum(factsRecord['inbox'], INBOX_STATES) ?? 'absent',
      acknowledgement: asEnum(factsRecord['acknowledgement'], ACK_STATES) ?? 'absent',
      action: asEnum(factsRecord['action'], ACTION_STATES) ?? 'requested',
      delegation: asEnum(factsRecord['delegation'], DELEGATION_STATES),
      devices: asDevices(factsRecord['devices']),
    },
    receivedAt: asTimestamp(record['receivedAt']) ?? 0,
  };
}

/** Accept the batch shapes a node may plausibly return without trusting any of it. */
export function parseEnvelopeBatch(value: unknown): { envelopes: Envelope[]; skipped: number } {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : (() => {
        const record = asRecord(value);
        if (record === null) return [];
        for (const key of ['envelopes', 'items', 'events'] as const) {
          if (Array.isArray(record[key])) return record[key] as unknown[];
        }
        return [];
      })();

  const envelopes: Envelope[] = [];
  let skipped = 0;
  for (const entry of raw.slice(0, 500)) {
    const parsed = parseEnvelope(entry);
    if (parsed === null) skipped += 1;
    else envelopes.push(parsed);
  }
  return { envelopes, skipped };
}

/* ------------------------------------------------------------------ *
 * Decision ledger
 * ------------------------------------------------------------------ */

/**
 * `defer` is a private local operational row: spec 0005 keeps dismissals off
 * the network. `approve`/`reject` are durable work recorded against the action
 * attempt, so they are queued for the node. `reopen` is the compensating
 * record that makes a decision reversible without erasing what happened.
 */
export const DECISION_KINDS = ['defer', 'approve', 'reject', 'reopen'] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

export type DecisionDurability = 'private-local' | 'durable-event';

export interface DecisionRecord {
  readonly sequence: number;
  readonly envelopeId: string;
  readonly kind: DecisionKind;
  readonly at: number;
  /** Envelope digest the approval binds to (spec 0005: approval binds message digest). */
  readonly bindsTo: string;
}

export type DecisionLedger = Readonly<Record<string, readonly DecisionRecord[]>>;

export interface DecisionOutcome {
  readonly ledger: DecisionLedger;
  readonly record: DecisionRecord;
}

export function durabilityOf(kind: DecisionKind): DecisionDurability {
  return kind === 'defer' ? 'private-local' : 'durable-event';
}

function nextSequence(ledger: DecisionLedger, envelopeId: string): number {
  const existing = ledger[envelopeId];
  return existing === undefined || existing.length === 0 ? 1 : existing[existing.length - 1]!.sequence + 1;
}

export function recordDecision(
  ledger: DecisionLedger,
  envelope: Envelope,
  kind: DecisionKind,
  now: number,
): DecisionOutcome {
  const record: DecisionRecord = {
    sequence: nextSequence(ledger, envelope.id),
    envelopeId: envelope.id,
    kind,
    at: now,
    bindsTo: envelope.id,
  };
  const existing = ledger[envelope.id] ?? [];
  return { ledger: { ...ledger, [envelope.id]: [...existing, record] }, record };
}

/** The latest record wins; history is retained for undo and audit. */
export function currentDecision(ledger: DecisionLedger, envelopeId: string): DecisionRecord | null {
  const records = ledger[envelopeId];
  if (records === undefined || records.length === 0) return null;
  return records[records.length - 1]!;
}

/** Undo is offered only while a reversal is still truthful (spec 0005). */
export const IRREVERSIBLE_ACTION_STATES: readonly ActionState[] = ['executing', 'succeeded', 'uncertain'];

export function canReverse(actionState: ActionState): boolean {
  return !IRREVERSIBLE_ACTION_STATES.includes(actionState);
}

/* ------------------------------------------------------------------ *
 * Derivations
 * ------------------------------------------------------------------ */

export function isExpired(envelope: Envelope, now: number): boolean {
  return envelope.policy.expiresAt !== null && envelope.policy.expiresAt <= now;
}

/**
 * The action dimension as it stands now: the envelope's own recorded attempt,
 * then the local decision, then expiry. No other dimension feeds this.
 */
export function deriveActionState(envelope: Envelope, ledger: DecisionLedger, now: number): ActionState {
  const decision = currentDecision(ledger, envelope.id);
  if (decision !== null) {
    if (decision.kind === 'approve') return 'approved';
    if (decision.kind === 'reject') return 'rejected';
    // `defer` and `reopen` leave the protocol-level attempt where it was.
  }
  if (isExpired(envelope, now)) return 'expired';
  return envelope.facts.action;
}

export function needsDecision(envelope: Envelope, ledger: DecisionLedger, now: number): boolean {
  const action = deriveActionState(envelope, ledger, now);
  if (action !== 'requested' && action !== 'awaiting_approval') return false;
  return envelope.policy.requiresApproval || action === 'awaiting_approval';
}

export function isDeferred(ledger: DecisionLedger, envelopeId: string): boolean {
  return currentDecision(ledger, envelopeId)?.kind === 'defer';
}

export interface Progress {
  readonly total: number;
  readonly decided: number;
  readonly deferred: number;
  readonly open: number;
  readonly percent: number;
}

export function summarize(envelopes: readonly Envelope[], ledger: DecisionLedger, now: number): Progress {
  let decided = 0;
  let deferred = 0;
  let open = 0;
  for (const envelope of envelopes) {
    const decision = currentDecision(ledger, envelope.id);
    if (decision?.kind === 'approve' || decision?.kind === 'reject') decided += 1;
    else if (decision?.kind === 'defer') deferred += 1;
    else if (needsDecision(envelope, ledger, now)) open += 1;
  }
  const actionable = decided + deferred + open;
  return {
    total: envelopes.length,
    decided,
    deferred,
    open,
    percent: actionable === 0 ? 100 : Math.round((decided / actionable) * 100),
  };
}

/** The single next action (Fogg): the first envelope still awaiting a decision. */
export function nextUndecided(
  envelopes: readonly Envelope[],
  ledger: DecisionLedger,
  now: number,
): Envelope | null {
  return envelopes.find((envelope) => needsDecision(envelope, ledger, now)) ?? null;
}

export type Tone = 'neutral' | 'progress' | 'attention' | 'good' | 'bad' | 'muted';

export interface AuthorshipView {
  readonly label: string;
  readonly mark: string;
  readonly detail: string;
  readonly tone: Tone;
  /** True when the envelope must never be read as human-authored. */
  readonly notHuman: boolean;
}

const AUTHORSHIP: Readonly<Record<ActorKind, AuthorshipView>> = {
  human: {
    label: 'Human',
    mark: '人',
    detail: 'Written and sent by a person.',
    tone: 'neutral',
    notHuman: false,
  },
  'agent-delegated': {
    label: 'Agent · delegated',
    mark: '托',
    detail:
      'Written or sent under a human delegation. The delegation is rechecked before any action starts, and can be expired or revoked.',
    tone: 'progress',
    notHuman: true,
  },
  'agent-autonomous': {
    label: 'Agent · autonomous',
    mark: '自',
    detail:
      'Created by an Agent under its own local policy. A signature proves control of a key over the asserted author; it does not prove that a person typed this.',
    tone: 'attention',
    notHuman: true,
  },
  system: {
    label: 'System',
    mark: '系',
    detail: 'Produced by a node for transport or synchronization. Carries no human or Agent authorship.',
    tone: 'muted',
    notHuman: true,
  },
};

export function authorshipView(kind: ActorKind): AuthorshipView {
  return AUTHORSHIP[kind];
}

export interface FactView {
  readonly dimension: string;
  readonly value: string;
  readonly tone: Tone;
  /** The independence rule this dimension must not be collapsed into. */
  readonly note: string;
}

const OUTBOUND_LABEL: Readonly<Record<OutboundState, string>> = {
  queued: 'Queued',
  sending: 'Sending',
  confirmed: 'Confirmed',
  retry_wait: 'Retry wait',
  rejected: 'Rejected',
  abandoned: 'Abandoned',
};

const STORAGE_LABEL: Readonly<Record<StorageState, string>> = {
  unknown: 'Unknown',
  accepted: 'Accepted',
  dependency_pending: 'Dependency pending',
  usable: 'Usable',
};

const PRESENTATION_LABEL: Readonly<Record<PresentationState, string>> = {
  unseen: 'Unseen',
  presented: 'Presented',
  read: 'Read',
};

const ACTION_LABEL: Readonly<Record<ActionState, string>> = {
  requested: 'Requested',
  awaiting_approval: 'Awaiting approval',
  approved: 'Approved',
  executing: 'Executing',
  succeeded: 'Succeeded',
  failed: 'Failed',
  uncertain: 'Uncertain',
  rejected: 'Rejected',
  expired: 'Expired',
};

const DELEGATION_LABEL: Readonly<Record<DelegationState, string>> = {
  granted: 'Granted',
  active: 'Active',
  expired: 'Expired',
  revoked: 'Revoked',
};

function toneForOutbound(state: OutboundState): Tone {
  if (state === 'confirmed') return 'good';
  if (state === 'rejected' || state === 'abandoned') return 'bad';
  if (state === 'retry_wait') return 'attention';
  return 'progress';
}

function toneForAction(state: ActionState): Tone {
  if (state === 'succeeded') return 'good';
  if (state === 'failed' || state === 'rejected' || state === 'expired') return 'bad';
  if (state === 'uncertain') return 'attention';
  if (state === 'approved' || state === 'executing') return 'progress';
  return 'neutral';
}

/** Per-device facts are retained; the aggregate never claims every device. */
export function presentationSummary(devices: readonly DeviceFacts[]): { value: string; tone: Tone } {
  if (devices.length === 0) return { value: 'No device reported', tone: 'muted' };
  const read = devices.filter((device) => device.presentation === 'read').length;
  const presented = devices.filter((device) => device.presentation === 'presented').length;
  if (read === 0 && presented === 0) return { value: `Unseen on all ${devices.length}`, tone: 'neutral' };
  if (read === devices.length) return { value: `Read on all ${devices.length}`, tone: 'good' };
  if (read > 0) return { value: `Read on ${read} of ${devices.length}`, tone: 'progress' };
  return { value: `Presented on ${presented} of ${devices.length}`, tone: 'progress' };
}

/**
 * Every dimension the envelope carries a fact for, rendered side by side with
 * the rule that keeps it independent. This is the view the inbox exists to
 * show; nothing here is merged into a single status.
 */
export function factViews(envelope: Envelope, ledger: DecisionLedger, now: number): FactView[] {
  const facts = envelope.facts;
  const action = deriveActionState(envelope, ledger, now);
  const views: FactView[] = [
    {
      dimension: 'Transport attempt',
      value: OUTBOUND_LABEL[facts.outbound],
      tone: toneForOutbound(facts.outbound),
      note: 'Whether this device reached the peer. Unrelated to whether anyone read it.',
    },
    {
      dimension: 'Recipient storage',
      value: STORAGE_LABEL[facts.storage],
      tone: facts.storage === 'usable' ? 'good' : facts.storage === 'dependency_pending' ? 'attention' : 'neutral',
      note: 'A dependency-pending event is stored but cannot authorize an effect.',
    },
    {
      dimension: 'Delivery',
      value: facts.inbox === 'delivered' ? 'Delivered' : 'Not delivered',
      tone: facts.inbox === 'delivered' ? 'good' : 'muted',
      note: 'Delivered never means read. Body availability is tracked separately.',
    },
    {
      dimension: 'Presentation',
      value: presentationSummary(facts.devices).value,
      tone: presentationSummary(facts.devices).tone,
      note: 'Kept per device. The aggregate never implies “read on every device”.',
    },
    {
      dimension: 'Acknowledgement',
      value: facts.acknowledgement === 'acknowledged' ? 'Acknowledged' : 'Not acknowledged',
      tone: facts.acknowledgement === 'acknowledged' ? 'good' : 'muted',
      note: 'Explicit only. Reading cannot acknowledge.',
    },
    {
      dimension: 'Action attempt',
      value: ACTION_LABEL[action],
      tone: toneForAction(action),
      note: 'Has its own approval and execution. An Agent may act on unread mail.',
    },
  ];

  if (facts.delegation !== null) {
    views.push({
      dimension: 'Delegation',
      value: DELEGATION_LABEL[facts.delegation],
      tone: facts.delegation === 'active' ? 'good' : facts.delegation === 'granted' ? 'progress' : 'bad',
      note: 'Rechecked when an action starts. Expiry cannot undo a completed external effect.',
    });
  }
  return views;
}

export function riskTone(risk: Risk): Tone {
  if (risk === 'high') return 'bad';
  if (risk === 'medium') return 'attention';
  return 'neutral';
}

export function actionLabel(state: ActionState): string {
  return ACTION_LABEL[state];
}

export function formatClock(timestamp: number, now: number): string {
  if (timestamp <= 0) return '—';
  const delta = now - timestamp;
  const minute = 60_000;
  if (Math.abs(delta) < minute) return 'just now';
  if (delta >= 0 && delta < 60 * minute) return `${Math.floor(delta / minute)}m ago`;
  if (delta >= 0 && delta < 24 * 60 * minute) return `${Math.floor(delta / (60 * minute))}h ago`;
  if (delta < 0) {
    const ahead = Math.abs(delta);
    if (ahead < 60 * minute) return `in ${Math.floor(ahead / minute)}m`;
    return `in ${Math.floor(ahead / (60 * minute))}h`;
  }
  return `${Math.floor(delta / (24 * 60 * minute))}d ago`;
}
