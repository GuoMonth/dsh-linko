/**
 * localStorage access, wrapped so a blocked or full store degrades to
 * "nothing remembered" instead of throwing.
 *
 * Everything kept here is *client-side convenience or client-side state*:
 *   - the node address, so a reload does not lose the configuration;
 *   - the sync cursor, so polling continues instead of re-reading the log;
 *   - the device id, so presentation facts stay per device;
 *   - unsent commands and unacknowledged decisions, so a reload does not lose
 *     work the user already asked for.
 *
 * None of it is authority. The cursor is scoped to one node and is discarded
 * when the node reports a reset; a decision is only real once the node has
 * accepted it (see model.ts).
 */

export const KEYS = {
  apiBase: 'linko.apiBase',
  cursor: 'linko.cursor',
  deviceId: 'linko.deviceId',
  outbox: 'linko.outbox',
  decisions: 'linko.decisions',
  dismissed: 'linko.dismissed',
  theme: 'linko.theme',
  bodyCache: 'linko.bodyCache',
  notifications: 'linko.notifications',
} as const;

/**
 * Dismissals are private UI state, not node facts. Keep them durable enough to
 * survive a reload while bounding local storage and letting old choices age out.
 */
export const DISMISSAL_MAX_ENTRIES = 128;
export const DISMISSAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export type DismissalLedger = Readonly<Record<string, number>>;

function validDismissalId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

function validDismissalAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Convert the original array format and the current timestamped format. */
export function normalizeDismissals(value: unknown, now: number): DismissalLedger {
  const entries: Array<[string, number]> = [];
  if (Array.isArray(value)) {
    for (const id of value) {
      if (validDismissalId(id)) entries.push([id, now]);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [id, raw] of Object.entries(value)) {
      if (!validDismissalId(id)) continue;
      const timestamp =
        validDismissalAt(raw)
          ? raw
          : typeof raw === 'object' && raw !== null && validDismissalAt((raw as { dismissedAt?: unknown }).dismissedAt)
            ? (raw as { dismissedAt: number }).dismissedAt
            : null;
      if (timestamp !== null) entries.push([id, timestamp]);
    }
  }
  return Object.fromEntries(entries);
}

/** Drop expired/corrupt rows and retain only the most recent bounded tail. */
export function pruneDismissals(ledger: DismissalLedger, now: number, maxAgeMs = DISMISSAL_MAX_AGE_MS): DismissalLedger {
  const cutoff = now - maxAgeMs;
  const entries = Object.entries(ledger)
    .filter(([id, timestamp]) => validDismissalId(id) && validDismissalAt(timestamp) && timestamp >= cutoff)
    // A future-dated local row must not survive indefinitely. Treat it as a
    // dismissal made now, while keeping the ledger useful after clock skew.
    .map(([id, timestamp]) => [id, Math.min(timestamp, now)] as [string, number])
    .sort((left, right) => right[1] - left[1])
    .slice(0, DISMISSAL_MAX_ENTRIES)
    .reverse();
  return Object.fromEntries(entries);
}

export function readDismissals(now = Date.now()): DismissalLedger {
  const normalized = normalizeDismissals(readJson<unknown>(KEYS.dismissed, {}), now);
  const pruned = pruneDismissals(normalized, now);
  writeDismissals(pruned, now);
  return pruned;
}

export function writeDismissals(ledger: DismissalLedger, now = Date.now()): void {
  writeJson(KEYS.dismissed, pruneDismissals(ledger, now));
}

/** Small, bounded cache for bodies fetched on demand. It is presentation
 * convenience only; the immutable envelope remains the source of truth. */
export type BodyCache = Record<string, string>;

export function readBodyCache(): BodyCache {
  const value = readJson<unknown>(KEYS.bodyCache, {});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const cache: BodyCache = {};
  for (const [key, body] of Object.entries(value)) {
    if (typeof body === 'string' && body.length <= 400_000) cache[key] = body;
  }
  return cache;
}

export function cacheBody(objectId: string, body: string): BodyCache {
  const cache = readBodyCache();
  cache[objectId] = body.slice(0, 400_000);
  const entries = Object.entries(cache).slice(-24);
  const bounded = Object.fromEntries(entries);
  writeJson(KEYS.bodyCache, bounded);
  return bounded;
}

export function readString(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === null || value.length === 0 ? null : value;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Remembering is a convenience, never a requirement.
  }
}

export function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // A corrupt entry is discarded rather than trusted.
    remove(key);
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    writeString(key, JSON.stringify(value));
  } catch {
    // Circular or oversized values are dropped rather than thrown.
  }
}
