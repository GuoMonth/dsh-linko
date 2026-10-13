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
 * Endpoints are the conceptual minimum from docs/specs/0003-lan-sync-and-transport.md.
 */

import { parseEnvelopeBatch, type DecisionRecord, type Envelope } from './model.js';

/** Default local node address. Overridable at runtime; nothing is hard-wired to it. */
export const DEFAULT_API_BASE = 'http://127.0.0.1:8477';

const REQUEST_TIMEOUT_MS = 3_500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const STORAGE_KEY = 'linko.apiBase';

export interface ApiConfig {
  readonly base: string;
  /** Where the value came from, shown in the UI so the setting is never a mystery. */
  readonly source: 'query' | 'injected' | 'stored' | 'default';
}

export interface NodeInfo {
  readonly nodeId: string;
  readonly protocolVersion: string;
}

export interface SyncResult {
  readonly envelopes: Envelope[];
  /** Envelopes the node sent that this client refused to parse. */
  readonly skipped: number;
  readonly cursor: string | null;
}

export interface DecisionPostResult {
  readonly ok: boolean;
  readonly detail: string;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function readStoredBase(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). Not an error.
    return null;
  }
}

export function rememberApiBase(base: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, base);
  } catch {
    // Remembering the address is a convenience, never a requirement.
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

export function configFromEnvironment(search: string): ApiConfig {
  const injected = (window as unknown as { __LINKO_CONFIG__?: { apiBase?: unknown } }).__LINKO_CONFIG__;
  const injectedBase = typeof injected?.apiBase === 'string' ? injected.apiBase : null;
  return resolveApiBase({
    query: new URLSearchParams(search).get('api'),
    injected: injectedBase,
    stored: readStoredBase(),
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
    throw new Error('Response exceeded the size limit.');
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error('Response exceeded the size limit.');
  }
  return JSON.parse(text) as unknown;
}

export async function fetchNode(base: string): Promise<NodeInfo | null> {
  try {
    const response = await fetch(`${base}/v1/node`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const value = await readJson(response);
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    return {
      nodeId: typeof record['nodeId'] === 'string' ? record['nodeId'] : 'unnamed node',
      protocolVersion: typeof record['protocolVersion'] === 'string' ? record['protocolVersion'] : 'unknown',
    };
  } catch {
    return null;
  }
}

export async function fetchEnvelopes(base: string, cursor: string | null): Promise<SyncResult> {
  const query = new URLSearchParams({ wait: '0' });
  if (cursor !== null) query.set('cursor', cursor);
  const response = await fetch(`${base}/v1/sync?${query.toString()}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Sync failed with status ${response.status}.`);
  const payload = await readJson(response);
  const parsed = parseEnvelopeBatch(payload);
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const nextCursor = record['cursor'];
  return {
    envelopes: parsed.envelopes,
    skipped: parsed.skipped,
    // The cursor is an opaque token scoped to this one peer (spec 0005).
    // It is kept in memory for this session only; nothing persists it.
    cursor: typeof nextCursor === 'string' && nextCursor.length <= 512 ? nextCursor : null,
  };
}

/**
 * Post one decision. The node owns durability; this client only reports what
 * it observed, so a failure here is surfaced rather than swallowed.
 */
export async function postDecision(base: string, record: DecisionRecord): Promise<DecisionPostResult> {
  try {
    const response = await fetch(`${base}/v1/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        eventId: record.envelopeId,
        actionId: 'primary',
        state: record.kind === 'approve' ? 'approved' : 'rejected',
        deviceId: 'device:web',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return response.ok
      ? { ok: true, detail: 'The node accepted the decision.' }
      : { ok: false, detail: `The node rejected the decision with status ${response.status}.` };
  } catch {
    return { ok: false, detail: 'The node could not be reached.' };
  }
}
