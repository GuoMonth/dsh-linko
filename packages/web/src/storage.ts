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
} as const;

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
