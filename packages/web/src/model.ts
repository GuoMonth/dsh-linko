/**
 * Linko inbox — pure domain model.
 *
 * Mirrors docs/specs/0002-message-envelope.md ("Independent delivery and reading
 * facts") and docs/specs/0005-state-and-storage.md ("Separate state dimensions").
 *
 * No DOM, no network, no framework. Every export is a pure function so that
 * scripts/smoke.mjs runs exactly the code the browser runs.
 *
 * Three rules are enforced structurally here rather than by convention in the
 * view layer:
 *
 *   1. Delivery, read, acknowledgement and action are independent dimensions.
 *      There is no combined status, and no derivation turns one into another.
 *   2. A decision is only real once the node says so. Local records describe a
 *      *submission attempt* (`pending`/`failed`/`confirmed`), never an outcome;
 *      the action fact is always the node's.
 *   3. An envelope from the network is untrusted input. `parseEnvelope` copies
 *      only known fields, bounds every string, strips control and bidi
 *      characters, and **rejects** an envelope whose actor kind it does not
 *      recognise rather than relabelling it.
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

export const OUTBOUND_STATES = ['queued', 'sending', 'confirmed', 'retry_wait', 'rejected', 'abandoned'] as const;
export type OutboundState = (typeof OUTBOUND_STATES)[number];

export const STORAGE_STATES = ['unknown', 'accepted', 'dependency_pending', 'usable'] as const;
export type StorageState = (typeof STORAGE_STATES)[number];

export const INBOX_STATES = ['absent', 'delivered'] as const;
export type InboxState = (typeof INBOX_STATES)[number];

export const PRESENTATION_STATES = ['unseen', 'presented', 'read'] as const;
export type PresentationState = (typeof PRESENTATION_STATES)[number];

export const ACK_STATES = ['absent', 'acknowledged'] as const;
export type AckState = (typeof ACK_STATES)[number];

/** The node's action vocabulary, including `expired` (spec 0005 policy terminal). */
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

export const DELEGATION_STATES = ['granted', 'active', 'expired', 'revoked'] as const;
export type DelegationState = (typeof DELEGATION_STATES)[number];

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

export interface Actor {
  readonly kind: ActorKind;
  readonly id: string;
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

/** Observations recorded against an envelope, each independent of the others. */
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
  /** The node-derived event id (`sha256:…`). */
  readonly id: string;
  /** Set by the receiving node; presence is provenance, not authorship proof. */
  readonly originPeerId: string | null;
  readonly kind: string;
  readonly cover: Cover;
  readonly actor: Actor;
  readonly semantic: Semantic;
  readonly policy: Policy;
  readonly inlineBody: string | null;
  /** Causal references. A reply names its parent here. */
  readonly parents: readonly string[];
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
  peers: 200,
} as const;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_OVERRIDES = /[‪-‮⁦-⁩‎‏]/g;

/**
 * Remove characters that could reorder or corrupt rendered text. This is not an
 * HTML sanitizer: the view layer never interprets markup, so this only protects
 * the plain-text rendering path.
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

function asRefs(value: unknown, max: number = MAX.refs): string[] {
  if (!Array.isArray(value)) return [];
  const refs: string[] = [];
  for (const entry of value.slice(0, max)) {
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
 * Narrow one untrusted envelope.
 *
 * Returns null when the envelope lacks a cover, an id, or — importantly — an
 * actor kind this client understands. An unknown kind is refused rather than
 * quietly rendered as `system`, because mislabelling authorship is exactly the
 * failure spec 0002 forbids ("An autonomous Agent message must never be rendered
 * as human-authored", and its converse: a stranger must not be shown as the
 * node itself).
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
  const kind = asEnum(actorRecord?.['kind'], ACTOR_KINDS);
  if (kind === null) return null;
  const actorId = asText(actorRecord?.['id'], MAX.id);
  if (actorId === null) return null;

  const semanticRecord = asRecord(record['semantic']) ?? {};
  const policyRecord = asRecord(record['policy']) ?? {};
  const factsRecord = asRecord(record['facts']) ?? {};
  const bodyRef = asRecord(record['bodyRef']);
  const surfaceRecord = asRecord(record['surfaceRef']);

  return {
    id,
    originPeerId: asText(record['originPeerId'], MAX.id),
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
    parents: asRefs(record['parents'], 8),
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

/** Accept the batch shapes a node may return without trusting any of it. */
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

/**
 * Merge a polled page into the inbox, deduplicated by event id.
 *
 * The node is authoritative and its facts only move forward, so the newer
 * server snapshot replaces the older one for the same event. Nothing is merged
 * field-by-field here: inventing a merge would put this client in the position
 * of deciding facts it does not own.
 */
export function mergeEnvelopes(existing: readonly Envelope[], incoming: readonly Envelope[]): Envelope[] {
  const byId = new Map<string, Envelope>();
  for (const envelope of existing) byId.set(envelope.id, envelope);
  for (const envelope of incoming) byId.set(envelope.id, envelope);
  return [...byId.values()];
}

/**
 * Return only events that arrived after the initial sync baseline. A first page
 * is historical recovery, even when it contains events this tab has not seen;
 * notifications are a later local convenience and never replay that history.
 */
export function newEnvelopeCandidates(
  existing: readonly Envelope[],
  incoming: readonly Envelope[],
  initialSyncComplete: boolean,
): Envelope[] {
  if (!initialSyncComplete) return [];
  const known = new Set(existing.map((envelope) => envelope.id));
  return incoming.filter((envelope) => !known.has(envelope.id));
}

/* ------------------------------------------------------------------ *
 * Peers
 * ------------------------------------------------------------------ */

export interface Peer {
  readonly peerId: string;
  readonly label: string;
  readonly status: string | null;
}

/** Parse `GET /v1/peers`. Accepts `{peers:[…]}` or a bare array. */
export function parsePeers(value: unknown): Peer[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : (() => {
        const record = asRecord(value);
        if (record === null) return [];
        return Array.isArray(record['peers']) ? (record['peers'] as unknown[]) : [];
      })();

  const peers: Peer[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, MAX.peers)) {
    const record = asRecord(entry);
    if (record === null) continue;
    const peerId = asText(record['peerId'], MAX.id) ?? asText(record['id'], MAX.id);
    if (peerId === null || seen.has(peerId)) continue;
    seen.add(peerId);
    peers.push({
      peerId,
      label: asText(record['label'], MAX.status) ?? asText(record['name'], MAX.status) ?? peerId,
      status: asText(record['status'], MAX.status),
    });
  }
  return peers;
}

/* ------------------------------------------------------------------ *
 * Outbound commands (compose, reply, send)
 * ------------------------------------------------------------------ */

/**
 * A composed message that has not yet been accepted by the node.
 *
 * `nonce` gives every composition a fresh identity even when the text repeats,
 * which is what keeps two identical-looking messages two events. The event id
 * itself is derived by the node from the canonical payload — this client must
 * not invent one, because the node rejects an id that does not match its hash.
 */
export interface OutboundCommand {
  readonly commandId: string;
  readonly clientId: string;
  readonly peerId: string;
  readonly envelope: Record<string, unknown>;
  readonly createdAt: number;
  readonly parentEventId: string | null;
  /** Local preview copy, so the outbox can be read without re-parsing the payload. */
  readonly title: string;
}

export type SendStatus = 'queued' | 'sending' | 'sent' | 'failed';

export interface SendRecord extends OutboundCommand {
  readonly status: SendStatus;
  readonly eventId: string | null;
  /** The node's delivery state verbatim, never inferred by this client. */
  readonly nodeDelivery: string | null;
  readonly error: string | null;
  readonly updatedAt: number;
}

export interface ComposeDraft {
  readonly peerId: string;
  readonly title: string;
  readonly preview: string;
  readonly body: string;
  readonly intent: Intent;
  readonly risk: Risk;
  readonly requiresApproval: boolean;
}

export interface ReplyTarget {
  readonly eventId: string;
  readonly title: string;
}

export const HUMAN_KIND = 'message.human';

/**
 * Build the envelope a person is sending.
 *
 * The result omits `id` on purpose: the node derives the event id from the
 * canonical payload and rejects a supplied id that does not match, so the
 * client's job is to make the payload unique (`nonce`) and idempotent
 * (`commandId`), not to name the event.
 */
export function buildHumanEnvelope(
  draft: ComposeDraft,
  options: { readonly nonce: string; readonly authorId: string; readonly replyTo: ReplyTarget | null; readonly now: number },
): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    kind: HUMAN_KIND,
    nonce: options.nonce,
    cover: {
      title: draft.title,
      preview: draft.preview,
      actor: { kind: 'human', id: options.authorId },
      status: draft.requiresApproval ? 'needs-human-approval' : 'informational',
    },
    semantic: {
      intent: draft.intent,
      contextRefs: [],
      availableActions: draft.requiresApproval ? ['approve', 'reject'] : [],
    },
    policy: {
      risk: draft.risk,
      requiresApproval: draft.requiresApproval,
      expiresAt: null,
      hopLimit: 5,
      fanoutLimit: 8,
    },
    createdAt: new Date(options.now).toISOString(),
  };
  if (draft.body.trim() !== '') envelope['inlineBody'] = draft.body;
  if (options.replyTo !== null) {
    envelope['parents'] = [options.replyTo.eventId];
    envelope['quote'] = { eventId: options.replyTo.eventId, title: options.replyTo.title };
  }
  return envelope;
}

export function isDraftSendable(draft: ComposeDraft): boolean {
  return draft.peerId.trim() !== '' && draft.title.trim() !== '';
}

/* ------------------------------------------------------------------ *
 * Decisions — submissions, not outcomes
 * ------------------------------------------------------------------ */

export type DecisionIntent = 'approve' | 'reject';
export type SubmissionStatus = 'pending' | 'confirmed' | 'failed';

/**
 * One attempt to record a decision on the node.
 *
 * `status` describes this client's submission, never the outcome:
 *   - `pending`   the request is in flight or waiting to be retried;
 *   - `confirmed` the node accepted it (the action fact then comes from the node);
 *   - `failed`    the node refused or was unreachable; nothing was decided.
 */
export interface DecisionRecord {
  readonly envelopeId: string;
  readonly intent: DecisionIntent;
  readonly actionId: string;
  readonly status: SubmissionStatus;
  readonly at: number;
  readonly error: string | null;
}

export type DecisionLedger = Readonly<Record<string, readonly DecisionRecord[]>>;

/** The action state a successful decision asks the node for. */
export function intentToActionState(intent: DecisionIntent): ActionState {
  return intent === 'approve' ? 'approved' : 'rejected';
}

export function recordDecision(
  ledger: DecisionLedger,
  envelopeId: string,
  intent: DecisionIntent,
  now: number,
): { ledger: DecisionLedger; record: DecisionRecord } {
  const record: DecisionRecord = {
    envelopeId,
    intent,
    actionId: intent,
    status: 'pending',
    at: now,
    error: null,
  };
  const existing = ledger[envelopeId] ?? [];
  return { ledger: { ...ledger, [envelopeId]: [...existing, record] }, record };
}

/** Resolve the newest submission attempt for an envelope in place. */
export function settleDecision(
  ledger: DecisionLedger,
  envelopeId: string,
  status: SubmissionStatus,
  error: string | null,
): DecisionLedger {
  const records = ledger[envelopeId];
  if (records === undefined || records.length === 0) return ledger;
  const last = records[records.length - 1]!;
  const settled: DecisionRecord = { ...last, status, error };
  return { ...ledger, [envelopeId]: [...records.slice(0, -1), settled] };
}

export function currentDecision(ledger: DecisionLedger, envelopeId: string): DecisionRecord | null {
  const records = ledger[envelopeId];
  if (records === undefined || records.length === 0) return null;
  return records[records.length - 1]!;
}

export function isPending(ledger: DecisionLedger, envelopeId: string): boolean {
  return currentDecision(ledger, envelopeId)?.status === 'pending';
}

/* ------------------------------------------------------------------ *
 * Derivations
 * ------------------------------------------------------------------ */

export function isExpired(envelope: Envelope, now: number): boolean {
  return envelope.policy.expiresAt !== null && envelope.policy.expiresAt <= now;
}

/**
 * The action dimension as it stands now.
 *
 * The node owns this fact. The only local input is expiry, which is a property
 * of the envelope's own policy and which the node enforces for approvals too
 * (`APPROVAL_EXPIRED`), so showing it cannot disagree with the server.
 */
export function deriveActionState(envelope: Envelope, now: number): ActionState {
  const action = envelope.facts.action;
  if ((action === 'requested' || action === 'awaiting_approval') && isExpired(envelope, now)) return 'expired';
  return action;
}

export function needsDecision(envelope: Envelope, ledger: DecisionLedger, now: number): boolean {
  const action = deriveActionState(envelope, now);
  if (action !== 'requested' && action !== 'awaiting_approval') return false;
  if (isPending(ledger, envelope.id)) return false;
  const decision = currentDecision(ledger, envelope.id);
  if (decision?.status === 'confirmed') return false;
  return envelope.policy.requiresApproval || action === 'awaiting_approval';
}

export interface Progress {
  readonly total: number;
  readonly decided: number;
  readonly open: number;
  readonly deferred: number;
  readonly percent: number;
}

export function summarize(
  envelopes: readonly Envelope[],
  ledger: DecisionLedger,
  dismissed: ReadonlySet<string>,
  now: number,
): Progress {
  let decided = 0;
  let open = 0;
  let deferred = 0;
  for (const envelope of envelopes) {
    if (dismissed.has(envelope.id)) {
      deferred += 1;
      continue;
    }
    const decision = currentDecision(ledger, envelope.id);
    if (decision?.status === 'confirmed') decided += 1;
    else if (needsDecision(envelope, ledger, now)) open += 1;
  }
  const actionable = decided + open + deferred;
  return {
    total: envelopes.length,
    decided,
    open,
    deferred,
    percent: actionable === 0 ? 100 : Math.round((decided / actionable) * 100),
  };
}

/** The single next action (Fogg): the first envelope still awaiting a decision. */
export function nextUndecided(
  envelopes: readonly Envelope[],
  ledger: DecisionLedger,
  dismissed: ReadonlySet<string>,
  now: number,
): Envelope | null {
  return envelopes.find((envelope) => !dismissed.has(envelope.id) && needsDecision(envelope, ledger, now)) ?? null;
}

export type Tone = 'neutral' | 'progress' | 'attention' | 'good' | 'bad' | 'muted';

export interface AuthorshipView {
  readonly kind: ActorKind;
  readonly mark: string;
  readonly tone: Tone;
  readonly notHuman: boolean;
}

const AUTHORSHIP: Readonly<Record<ActorKind, AuthorshipView>> = {
  human: { kind: 'human', mark: '人', tone: 'neutral', notHuman: false },
  'agent-delegated': { kind: 'agent-delegated', mark: '托', tone: 'progress', notHuman: true },
  'agent-autonomous': { kind: 'agent-autonomous', mark: '自', tone: 'attention', notHuman: true },
  system: { kind: 'system', mark: '系', tone: 'muted', notHuman: true },
};

export function authorshipView(kind: ActorKind): AuthorshipView {
  return AUTHORSHIP[kind];
}

/** Stable keys for the fact rows; copy lives in render.ts so it can be bilingual. */
export const FACT_DIMENSIONS = [
  'transport',
  'storage',
  'delivery',
  'presentation',
  'acknowledgement',
  'action',
  'delegation',
] as const;
export type FactDimension = (typeof FACT_DIMENSIONS)[number];

export interface FactView {
  readonly dimension: FactDimension;
  /** Vocabulary token from the spec, rendered as-is so it cannot drift. */
  readonly value: string;
  readonly tone: Tone;
}

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
export function presentationSummary(devices: readonly DeviceFacts[]): { read: number; presented: number; total: number } {
  let read = 0;
  let presented = 0;
  for (const device of devices) {
    if (device.presentation === 'read') read += 1;
    else if (device.presentation === 'presented') presented += 1;
  }
  return { read, presented, total: devices.length };
}

/**
 * Every dimension the envelope carries a fact for, side by side with the rule
 * that keeps it independent. Nothing here is merged into a single status.
 */
export function factViews(envelope: Envelope, now: number): FactView[] {
  const facts = envelope.facts;
  const action = deriveActionState(envelope, now);
  const views: FactView[] = [
    { dimension: 'transport', value: facts.outbound, tone: toneForOutbound(facts.outbound) },
    {
      dimension: 'storage',
      value: facts.storage,
      tone: facts.storage === 'usable' ? 'good' : facts.storage === 'dependency_pending' ? 'attention' : 'neutral',
    },
    { dimension: 'delivery', value: facts.inbox, tone: facts.inbox === 'delivered' ? 'good' : 'muted' },
    {
      dimension: 'presentation',
      value: presentationToken(facts.devices),
      tone: presentationSummary(facts.devices).read > 0 ? 'progress' : 'neutral',
    },
    {
      dimension: 'acknowledgement',
      value: facts.acknowledgement,
      tone: facts.acknowledgement === 'acknowledged' ? 'good' : 'muted',
    },
    { dimension: 'action', value: action, tone: toneForAction(action) },
  ];
  if (facts.delegation !== null) {
    views.push({
      dimension: 'delegation',
      value: facts.delegation,
      tone: facts.delegation === 'active' ? 'good' : facts.delegation === 'granted' ? 'progress' : 'bad',
    });
  }
  return views;
}

/**
 * Presentation is reported as an explicit per-device ratio, never as a single
 * boolean: "read on one device" and "read on every device" are different facts
 * and spec 0002 forbids conflating them.
 */
export function presentationToken(devices: readonly DeviceFacts[]): string {
  const { read, presented, total } = presentationSummary(devices);
  if (total === 0) return 'no-device-reported';
  if (read === total) return `read:all-${total}`;
  if (read > 0) return `read:${read}-of-${total}`;
  if (presented > 0) return `presented:${presented}-of-${total}`;
  return `unseen:0-of-${total}`;
}

export function riskTone(risk: Risk): Tone {
  if (risk === 'high') return 'bad';
  if (risk === 'medium') return 'attention';
  return 'neutral';
}

export function formatClock(timestamp: number, now: number): string {
  if (timestamp <= 0) return '—';
  const delta = now - timestamp;
  const minute = 60_000;
  if (Math.abs(delta) < minute) return '刚刚';
  if (delta >= 0 && delta < 60 * minute) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta >= 0 && delta < 24 * 60 * minute) return `${Math.floor(delta / (60 * minute))} 小时前`;
  if (delta < 0) {
    const ahead = Math.abs(delta);
    if (ahead < 60 * minute) return `${Math.floor(ahead / minute)} 分钟后`;
    return `${Math.floor(ahead / (60 * minute))} 小时后`;
  }
  return `${Math.floor(delta / (24 * 60 * minute))} 天前`;
}

/* ------------------------------------------------------------------ *
 * Local identity
 * ------------------------------------------------------------------ */

/** A per-browser device id, used so presentation facts stay per device. */
export function deviceIdFor(seed: string): string {
  return `device:web:${seed.slice(0, 8)}`;
}
