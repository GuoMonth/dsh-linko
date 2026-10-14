/**
 * Local node client.
 *
 * The inbox is a client of one local Linko node, never a client of peers, so
 * every request goes to a single configurable API base and every response is
 * treated as untrusted data:
 *
 *   - only `http:`/`https:` bases are accepted, so a crafted `?api=` value
 *     cannot smuggle another scheme into `fetch`;
 *   - responses are size-capped before parsing and must be JSON;
 *   - nothing from a response is interpreted as markup (see render.ts).
 *
 * Endpoints follow docs/specs/0003-lan-sync-and-transport.md and the MVP
 * contract: `/v1/node`, `/v1/sync`, `/v1/receipts`, `/v1/peers`, `/v1/send`.
 *
 * Transport security is not this client's claim to make: TLS and peer
 * authentication belong to the node and to a later phase. Nothing here should
 * be read as asserting that a LAN connection is safe.
 */

import { parseEnvelopeBatch, parsePeers, type DecisionIntent, type Envelope, type Peer } from './model.js';

/** Default local node address. Overridable at runtime; nothing is hard-wired to it. */
export const DEFAULT_API_BASE = 'http://127.0.0.1:8787';

const REQUEST_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export interface ApiConfig {
  readonly base: string;
  readonly source: 'query' | 'injected' | 'stored' | 'default';
}

export interface NodeInfo {
  readonly nodeId: string;
  readonly protocolVersion: string;
  readonly logEpoch: string;
}

export interface SyncResult {
  readonly envelopes: Envelope[];
  readonly skipped: number;
  readonly cursor: string | null;
  /** The node refused the stored cursor and wants a fresh pull. */
  readonly resetRequired: boolean;
}

/** A structured outcome, so callers can report *why* something failed. */
export type ApiOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly detail: string; readonly status: number | null };

export interface PeerDirectory {
  readonly peers: Peer[];
  /** False when the node does not expose a peer directory yet. */
  readonly available: boolean;
}

export interface SendResult {
  readonly eventId: string;
  readonly duplicate: boolean;
  /**
   * The node's own delivery state for the queued event (`queued`,
   * `confirmed`, …). Reported as-is: this client does not know, and must not
   * guess, whether a peer actually received anything.
   */
  readonly delivery: string | null;
  readonly envelope: Envelope | null;
}

export interface ReceiptResult {
  readonly envelope: Envelope | null;
  readonly state: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface ApiBaseInputs {
  readonly query: string | null;
  readonly injected: string | null;
  readonly stored: string | null;
}

/** Precedence: explicit link, then host-provided config, then remembered, then default. */
export function resolveApiBase(inputs: ApiBaseInputs): ApiConfig {
  const candidates: readonly (readonly [ApiConfig['source'], string | null])[] = [
    ['query', inputs.query],
    ['injected', inputs.injected],
    ['stored', inputs.stored],
  ];
  for (const [source, candidate] of candidates) {
    if (candidate !== null && isHttpUrl(candidate)) {
      return { base: candidate.replace(/\/+$/, ''), source };
    }
  }
  return { base: DEFAULT_API_BASE, source: 'default' };
}

export function configFromEnvironment(search: string, stored: string | null): ApiConfig {
  const injected = (window as unknown as { __LINKO_CONFIG__?: { apiBase?: unknown } }).__LINKO_CONFIG__;
  const injectedBase = typeof injected?.apiBase === 'string' ? injected.apiBase : null;
  return resolveApiBase({
    query: new URLSearchParams(search).get('api'),
    injected: injectedBase,
    stored,
  });
}

/**
 * Read a response defensively: cap the size, require JSON, and let the caller
 * narrow the parsed value. A node that returns HTML, or an intermediary that
 * returns a captive-portal page, becomes a clean failure instead of a crash.
 */
async function readJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('response-too-large');
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error('response-too-large');
  return JSON.parse(text) as unknown;
}

/** Pull the node's own error code out of a failure body, without trusting it. */
function errorDetail(payload: unknown, status: number): { code: string; detail: string } {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const error = typeof record['error'] === 'object' && record['error'] !== null
    ? (record['error'] as Record<string, unknown>)
    : {};
  const code = typeof error['code'] === 'string' && error['code'].length <= 60 ? error['code'] : `http-${status}`;
  const message = typeof error['message'] === 'string' && error['message'].length <= 200 ? error['message'] : '';
  return { code, detail: message };
}

async function requestJson(
  base: string,
  path: string,
  init: RequestInit,
): Promise<ApiOutcome<unknown>> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    return { ok: false, code: 'unreachable', detail: '', status: null };
  }
  let payload: unknown = null;
  try {
    payload = await readJson(response);
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const { code, detail } = errorDetail(payload, response.status);
    return { ok: false, code, detail, status: response.status };
  }
  return { ok: true, value: payload };
}

export async function fetchNode(base: string): Promise<NodeInfo | null> {
  const outcome = await requestJson(base, '/v1/node', { headers: { accept: 'application/json' } });
  if (!outcome.ok) return null;
  const record = typeof outcome.value === 'object' && outcome.value !== null
    ? (outcome.value as Record<string, unknown>)
    : {};
  return {
    nodeId: typeof record['nodeId'] === 'string' ? record['nodeId'] : 'unnamed node',
    protocolVersion: typeof record['protocolVersion'] === 'string' ? record['protocolVersion'] : 'unknown',
    logEpoch: typeof record['logEpoch'] === 'string' ? record['logEpoch'] : 'unknown',
  };
}

export async function fetchEnvelopes(base: string, cursor: string | null): Promise<ApiOutcome<SyncResult>> {
  const query = new URLSearchParams({ wait: '0' });
  if (cursor !== null) query.set('cursor', cursor);
  const outcome = await requestJson(base, `/v1/sync?${query.toString()}`, {
    headers: { accept: 'application/json' },
  });

  if (!outcome.ok) {
    // A cursor the node no longer honours is not an error the user should see:
    // it is an instruction to pull from the start, exactly once (spec 0005).
    if (outcome.code === 'CURSOR_RESET' || outcome.status === 409) {
      return { ok: true, value: { envelopes: [], skipped: 0, cursor: null, resetRequired: true } };
    }
    return outcome;
  }

  const parsed = parseEnvelopeBatch(outcome.value);
  const record = typeof outcome.value === 'object' && outcome.value !== null
    ? (outcome.value as Record<string, unknown>)
    : {};
  const nextCursor = record['cursor'];
  return {
    ok: true,
    value: {
      envelopes: parsed.envelopes,
      skipped: parsed.skipped,
      cursor: typeof nextCursor === 'string' && nextCursor.length <= 512 ? nextCursor : null,
      resetRequired: false,
    },
  };
}

export async function fetchPeers(base: string): Promise<PeerDirectory> {
  const outcome = await requestJson(base, '/v1/peers', { headers: { accept: 'application/json' } });
  if (!outcome.ok) {
    // 404 means this node has no peer directory yet — a capability gap, not a
    // failure, and the UI says so rather than showing an empty list as fact.
    return { peers: [], available: false };
  }
  return { peers: parsePeers(outcome.value), available: true };
}

/**
 * Send one composed envelope to a peer.
 *
 * `clientId` + `commandId` are the retry identity (spec 0005): re-sending the
 * same command must not create a second event, so a retry reuses both and lets
 * the node collapse it.
 */
export async function sendEnvelope(
  base: string,
  command: { peerId: string; envelope: Record<string, unknown>; clientId: string; commandId: string },
): Promise<ApiOutcome<SendResult>> {
  const outcome = await requestJson(base, '/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      peerId: command.peerId,
      envelope: command.envelope,
      clientId: command.clientId,
      commandId: command.commandId,
    }),
  });
  if (!outcome.ok) return outcome;

  const record = typeof outcome.value === 'object' && outcome.value !== null
    ? (outcome.value as Record<string, unknown>)
    : {};
  const eventId = typeof record['eventId'] === 'string' ? record['eventId'] : null;
  if (eventId === null) {
    return { ok: false, code: 'malformed-response', detail: '', status: null };
  }
  const parsed = parseEnvelopeBatch({ events: [record['event'] ?? record['envelope']] });
  const delivery = record['delivery'];
  return {
    ok: true,
    value: {
      eventId,
      duplicate: record['duplicate'] === true,
      delivery: typeof delivery === 'string' && delivery.length <= 40 ? delivery : null,
      envelope: parsed.envelopes[0] ?? null,
    },
  };
}

/**
 * Record one receipt against an envelope.
 *
 * Used for three separate dimensions — presentation, read, acknowledgement —
 * and for action decisions. The caller must not treat a returned envelope as
 * proof of anything other than what the node reported back.
 */
export async function postReceipt(
  base: string,
  receipt: { eventId: string; state: string; actionId?: string; deviceId?: string },
): Promise<ApiOutcome<ReceiptResult>> {
  const body: Record<string, unknown> = { eventId: receipt.eventId, state: receipt.state };
  if (receipt.actionId !== undefined) body['actionId'] = receipt.actionId;
  if (receipt.deviceId !== undefined) body['deviceId'] = receipt.deviceId;

  const outcome = await requestJson(base, '/v1/receipts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!outcome.ok) return outcome;

  const record = typeof outcome.value === 'object' && outcome.value !== null
    ? (outcome.value as Record<string, unknown>)
    : {};
  const wire = record['event'];
  const parsed = parseEnvelopeBatch({ events: [wire] });
  return {
    ok: true,
    value: {
      envelope: parsed.envelopes[0] ?? null,
      state: typeof record['state'] === 'string' ? record['state'] : receipt.state,
    },
  };
}

export function decisionStateFor(intent: DecisionIntent): string {
  return intent === 'approve' ? 'approved' : 'rejected';
}
