import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActionState, Envelope, EventState, SyncItem } from "./types.js";

const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_BATCH = 100;

export class StoreError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type SqlRow = Record<string, unknown>;

function asRow(value: unknown): SqlRow | undefined {
  return value && typeof value === "object" ? (value as SqlRow) : undefined;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StoreError("INVALID_INPUT", `${field} must be a non-empty string`);
  }
  return value;
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoreError("INVALID_INPUT", "envelope must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function canonicalize(value: unknown): string {
  return canonicalizeAt(value, 0);
}

function canonicalizeAt(value: unknown, depth: number): string {
  if (depth > 64) throw new StoreError("PAYLOAD_TOO_DEEP", "envelope nesting exceeds 64 levels", 400);
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeAt(item, depth + 1)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeAt(object[key], depth + 1)}`)
      .join(",")}}`;
  }
  throw new StoreError("INVALID_INPUT", "envelope contains an unsupported JSON value");
}

function deriveEventId(value: Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
}

function now(): string {
  return new Date().toISOString();
}

function isActionState(value: string): value is ActionState {
  return [
    "requested",
    "awaiting_approval",
    "approved",
    "executing",
    "succeeded",
    "failed",
    "uncertain",
    "rejected",
    "expired",
  ].includes(value);
}

function actionTransitionAllowed(previous: ActionState | null, next: ActionState): boolean {
  if (previous === null || previous === next) return true;
  const allowed: Record<ActionState, readonly ActionState[]> = {
    requested: ["awaiting_approval", "approved", "rejected", "expired"],
    awaiting_approval: ["approved", "rejected", "expired"],
    approved: ["executing", "rejected", "expired"],
    executing: ["succeeded", "failed", "uncertain"],
    failed: ["executing", "rejected", "expired"],
    succeeded: [],
    uncertain: [],
    rejected: [],
    expired: [],
  };
  return allowed[previous].includes(next);
}

function asEnvelope(value: unknown): Envelope {
  const input = jsonObject(value);
  const rawSize = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (rawSize > MAX_EVENT_BYTES) {
    throw new StoreError("PAYLOAD_TOO_LARGE", `envelope exceeds ${MAX_EVENT_BYTES} bytes`, 413);
  }
  const copy: Record<string, unknown> = { ...input };
  const providedId = typeof copy.id === "string" && copy.id.length > 0
    ? copy.id
    : typeof copy.eventId === "string" && copy.eventId.length > 0
      ? copy.eventId
      : undefined;
  delete copy.eventId;
  delete copy.id;
  delete copy.attemptId;
  delete copy.commandId;
  delete copy.clientId;
  const derivedId = deriveEventId(copy);
  if (providedId !== undefined && providedId !== derivedId) {
    throw new StoreError("EVENT_ID_MISMATCH", "event id does not match canonical payload", 409);
  }
  const id = derivedId;
  const envelope = { ...copy, id } as Envelope;
  const bytes = Buffer.byteLength(canonicalize(envelope), "utf8");
  if (bytes > MAX_EVENT_BYTES) {
    throw new StoreError("PAYLOAD_TOO_LARGE", `envelope exceeds ${MAX_EVENT_BYTES} bytes`, 413);
  }
  return envelope;
}

function decodeEnvelope(value: unknown): Envelope {
  if (typeof value !== "string") {
    throw new StoreError("STORAGE_CORRUPT", "stored envelope is not JSON", 500);
  }
  try {
    return JSON.parse(value) as Envelope;
  } catch {
    throw new StoreError("STORAGE_CORRUPT", "stored envelope is invalid JSON", 500);
  }
}

function encodeCursor(epoch: string, cursor: number): string {
  return Buffer.from(JSON.stringify({ epoch, cursor }), "utf8").toString("base64url");
}

function decodeCursor(token: string | undefined, epoch: string, maxCursor: number): number {
  if (!token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { epoch?: unknown; cursor?: unknown };
    if (parsed.epoch !== epoch) {
      throw new StoreError("CURSOR_RESET", "cursor belongs to a different log epoch", 409, {
        resetRequired: true,
        logEpoch: epoch,
      });
    }
    if (typeof parsed.cursor !== "number" || !Number.isSafeInteger(parsed.cursor) || parsed.cursor < 0) {
      throw new Error("invalid cursor");
    }
    if (parsed.cursor > maxCursor) {
      throw new StoreError("CURSOR_RESET", "cursor is ahead of the local log", 409, {
        resetRequired: true,
        logEpoch: epoch,
      });
    }
    return parsed.cursor;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("INVALID_CURSOR", "cursor is not valid", 400);
  }
}

export interface NodeStoreOptions {
  dbPath?: string;
  nodeId?: string;
}

export interface InsertResult {
  eventId: string;
  cursor: number;
  duplicate: boolean;
  attemptId: string;
  item: SyncItem;
}

export interface SyncResult {
  events: SyncItem[];
  cursor: string;
  nextCursor: string;
  hasMore: boolean;
  logEpoch: string;
}

export class NodeStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;

  constructor(options: NodeStoreOptions = {}) {
    this.dbPath = options.dbPath ?? process.env.LINKO_DB ?? ".linko/node.sqlite";
    if (this.dbPath !== ":memory:") mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        cursor INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        canonical_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS inbox (
        event_id TEXT PRIMARY KEY REFERENCES events(event_id),
        delivered_at TEXT NOT NULL,
        presented_at TEXT,
        read_at TEXT,
        acknowledged_at TEXT
      );
      CREATE TABLE IF NOT EXISTS receipt_facts (
        event_id TEXT NOT NULL REFERENCES events(event_id),
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        PRIMARY KEY (event_id, device_id, kind)
      );
      CREATE TABLE IF NOT EXISTS delivery_attempts (
        attempt_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL REFERENCES events(event_id),
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS commands (
        client_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        event_id TEXT NOT NULL REFERENCES events(event_id),
        payload_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (client_id, command_id)
      );
      CREATE TABLE IF NOT EXISTS actions (
        event_id TEXT NOT NULL REFERENCES events(event_id),
        action_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (event_id, action_id)
      );
    `);
    const nodeId = options.nodeId ?? process.env.LINKO_NODE_ID ?? `node:${randomUUID()}`;
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('node_id', ?)").run(nodeId);
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('log_epoch', ?)").run(`epoch:${randomUUID()}`);
  }

  get nodeId(): string {
    return String(asRow(this.db.prepare("SELECT value FROM meta WHERE key = 'node_id'").get())?.value);
  }

  get logEpoch(): string {
    return String(asRow(this.db.prepare("SELECT value FROM meta WHERE key = 'log_epoch'").get())?.value ?? "unknown");
  }

  close(): void {
    this.db.close();
  }

  health(): { status: "ok"; nodeId: string; storage: "sqlite"; logEpoch: string } {
    this.db.prepare("SELECT 1").get();
    return { status: "ok", nodeId: this.nodeId, storage: "sqlite", logEpoch: this.logEpoch };
  }

  nodeInfo(): Record<string, unknown> {
    return {
      nodeId: this.nodeId,
      protocolVersion: "v1",
      schemaVersion: 1,
      logEpoch: this.logEpoch,
      storage: "sqlite",
      capabilities: {
        envelopes: true,
        receipts: true,
        cursorSync: true,
        websocketHints: false,
      },
      notes: ["REST is the canonical sync path; optional WebSocket wake-up hints are deferred in this MVP."],
    };
  }

  private eventRow(eventId: string): SqlRow {
    const row = asRow(this.db.prepare(`
      SELECT e.cursor, e.event_id, e.canonical_json, i.delivered_at, i.presented_at,
             i.read_at, i.acknowledged_at
      FROM events e JOIN inbox i ON i.event_id = e.event_id
      WHERE e.event_id = ?
    `).get(eventId));
    if (!row) throw new StoreError("NOT_FOUND", `event ${eventId} was not found`, 404);
    return row;
  }

  private itemFromRow(row: SqlRow): SyncItem {
    const eventId = String(row.event_id);
    const deviceRows = this.db.prepare(
      "SELECT device_id, kind, recorded_at FROM receipt_facts WHERE event_id = ? ORDER BY device_id",
    ).all(eventId) as unknown as SqlRow[];
    const devices = new Map<string, "unseen" | "presented" | "read">();
    for (const fact of deviceRows) {
      const deviceId = String(fact.device_id);
      const kind = String(fact.kind);
      const current = devices.get(deviceId) ?? "unseen";
      const next = kind === "read" || (kind === "presented" && current === "unseen") ? kind : current;
      if (next === "presented" || next === "read") devices.set(deviceId, next);
    }
    if (devices.size === 0 && (row.presented_at !== null || row.read_at !== null)) {
      devices.set("device:local", row.read_at !== null ? "read" : "presented");
    }
    const actions = this.db.prepare(
      "SELECT action_id, status, updated_at FROM actions WHERE event_id = ? ORDER BY action_id",
    ).all(eventId) as unknown as SqlRow[];
    const actionState: EventState["actions"] = {};
    for (const action of actions) {
      actionState[String(action.action_id)] = {
        status: String(action.status) as ActionState,
        updatedAt: String(action.updated_at),
      };
    }
    return {
      id: eventId,
      eventId,
      cursor: Number(row.cursor),
      envelope: decodeEnvelope(row.canonical_json),
      state: {
        delivered: true,
        deliveredAt: String(row.delivered_at),
        presentedAt: row.presented_at === null ? null : String(row.presented_at),
        readAt: row.read_at === null ? null : String(row.read_at),
        acknowledgedAt: row.acknowledged_at === null ? null : String(row.acknowledged_at),
        devices: [...devices.entries()].map(([deviceId, presentation]) => ({ deviceId, presentation })),
        actions: actionState,
      },
    };
  }

  getItem(eventId: string): SyncItem {
    return this.itemFromRow(this.eventRow(stringValue(eventId, "eventId")));
  }

  insertEnvelope(value: unknown, attemptId?: unknown, commandId?: unknown, clientId?: unknown): InsertResult {
    const envelope = asEnvelope(value);
    const eventId = envelope.id;
    const canonical = canonicalize(envelope);
    const payloadHash = createHash("sha256").update(canonical).digest("hex");
    const id = typeof attemptId === "string" && attemptId.length > 0 ? attemptId : `attempt:${randomUUID()}`;
    const command = typeof commandId === "string" && commandId.length > 0 ? commandId : undefined;
    const client = typeof clientId === "string" && clientId.length > 0 ? clientId : "client:local";
    const timestamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const attempt = asRow(this.db.prepare(
        "SELECT event_id FROM delivery_attempts WHERE attempt_id = ?",
      ).get(id));
      if (attempt && String(attempt.event_id) !== eventId) {
        throw new StoreError("ATTEMPT_CONFLICT", "attempt id is already bound to another event", 409);
      }
      if (command !== undefined) {
        const previous = asRow(this.db.prepare(
          "SELECT event_id, payload_hash FROM commands WHERE client_id = ? AND command_id = ?",
        ).get(client, command));
        if (previous) {
          if (String(previous.payload_hash) !== payloadHash) {
            throw new StoreError("COMMAND_CONFLICT", "command id is already bound to another payload", 409);
          }
          const previousEvent = this.eventRow(String(previous.event_id));
          this.db.prepare(
            "INSERT OR IGNORE INTO delivery_attempts(attempt_id, event_id, status, created_at) VALUES (?, ?, 'accepted_duplicate', ?)",
          ).run(id, String(previous.event_id), timestamp);
          this.db.exec("COMMIT");
          return {
            eventId: String(previous.event_id),
            cursor: Number(previousEvent.cursor),
            duplicate: true,
            attemptId: id,
            item: this.getItem(String(previous.event_id)),
          };
        }
      }
      const existing = asRow(this.db.prepare(
        "SELECT cursor, event_id, canonical_json FROM events WHERE event_id = ?",
      ).get(eventId));
      if (existing) {
        if (String(existing.canonical_json) !== canonical) {
          throw new StoreError("EVENT_CONFLICT", `event ${eventId} has different canonical bytes`, 409);
        }
        this.db.prepare(
          "INSERT OR IGNORE INTO delivery_attempts(attempt_id, event_id, status, created_at) VALUES (?, ?, 'accepted_duplicate', ?)",
        ).run(id, eventId, timestamp);
        this.db.exec("COMMIT");
        return {
          eventId,
          cursor: Number(existing.cursor),
          duplicate: true,
          attemptId: id,
          item: this.getItem(eventId),
        };
      }
      this.db.prepare(
        "INSERT INTO events(event_id, canonical_json, created_at) VALUES (?, ?, ?)",
      ).run(eventId, canonical, timestamp);
      if (command !== undefined) {
        this.db.prepare(
          "INSERT INTO commands(client_id, command_id, event_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(client, command, eventId, payloadHash, timestamp);
      }
      const inserted = asRow(this.db.prepare("SELECT cursor FROM events WHERE event_id = ?").get(eventId));
      if (!inserted) throw new StoreError("STORAGE_ERROR", "event insert did not return a cursor", 500);
      this.db.prepare("INSERT INTO inbox(event_id, delivered_at) VALUES (?, ?)").run(eventId, timestamp);
      this.db.prepare(
        "INSERT INTO delivery_attempts(attempt_id, event_id, status, created_at) VALUES (?, ?, 'delivered', ?)",
      ).run(id, eventId, timestamp);
      this.db.exec("COMMIT");
      return {
        eventId,
        cursor: Number(inserted.cursor),
        duplicate: false,
        attemptId: id,
        item: this.getItem(eventId),
      };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      if (error instanceof StoreError) throw error;
      throw new StoreError("STORAGE_ERROR", error instanceof Error ? error.message : "storage operation failed", 500);
    }
  }

  sync(token?: string, limit = MAX_BATCH): SyncResult {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_BATCH);
    const epoch = this.logEpoch;
    const maxCursor = Number(asRow(this.db.prepare("SELECT MAX(cursor) AS max_cursor FROM events").get())?.max_cursor ?? 0);
    const start = decodeCursor(token, epoch, maxCursor);
    const rows = this.db.prepare(`
      SELECT e.cursor, e.event_id, e.canonical_json, i.delivered_at, i.presented_at,
             i.read_at, i.acknowledged_at
      FROM events e JOIN inbox i ON i.event_id = e.event_id
      WHERE e.cursor > ? ORDER BY e.cursor LIMIT ?
    `).all(start, boundedLimit + 1) as unknown as SqlRow[];
    const hasMore = rows.length > boundedLimit;
    const page = hasMore ? rows.slice(0, boundedLimit) : rows;
    const end = page.length > 0 ? Number(page[page.length - 1].cursor) : start;
    const nextCursor = encodeCursor(epoch, end);
    return {
      events: page.map((row) => this.itemFromRow(row)),
      cursor: nextCursor,
      nextCursor,
      hasMore,
      logEpoch: epoch,
    };
  }

  receipt(input: unknown): { item: SyncItem; kind: string; state: string; actionId?: string } {
    const body = jsonObject(input);
    const eventId = stringValue(body.eventId ?? body.id, "eventId");
    const item = this.getItem(eventId);
    const actionIdValue = body.actionId ?? (body.action && typeof body.action === "object" ? (body.action as Record<string, unknown>).id : undefined);
    const rawState = body.state ?? body.status ?? body.type ?? body.kind;
    const state = stringValue(rawState, "state");
    const actionState = isActionState(state) ? state : undefined;
    const kind = actionState ? "action" : state;
    const timestamp = now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (actionState) {
        const actionId = stringValue(actionIdValue, "actionId");
        const envelope = item.envelope;
        const policy = envelope.policy;
        const expiresAt = policy && typeof policy === "object" && !Array.isArray(policy)
          ? (policy as Record<string, unknown>).expiresAt
          : undefined;
        if (actionState === "approved" && typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now()) {
          throw new StoreError("APPROVAL_EXPIRED", "the envelope approval window has expired", 409);
        }
        const existingAction = asRow(this.db.prepare(
          "SELECT status FROM actions WHERE event_id = ? AND action_id = ?",
        ).get(eventId, actionId));
        if (existingAction && !actionTransitionAllowed(String(existingAction.status) as ActionState, actionState)) {
          throw new StoreError("INVALID_TRANSITION", `action ${actionId} cannot move from ${String(existingAction.status)} to ${actionState}`, 409);
        }
        this.db.prepare(`
          INSERT INTO actions(event_id, action_id, status, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(event_id, action_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
        `).run(eventId, actionId, actionState, timestamp);
        this.db.exec("COMMIT");
        return { item: this.getItem(eventId), kind, state: actionState, actionId };
      }
      if (!["presented", "read", "acknowledged"].includes(state)) {
        throw new StoreError("INVALID_INPUT", `unsupported receipt state ${state}`);
      }
      const column = state === "presented" ? "presented_at" : state === "read" ? "read_at" : "acknowledged_at";
      const deviceId = typeof body.deviceId === "string" && body.deviceId.length > 0 ? body.deviceId : "device:local";
      this.db.prepare(
        "INSERT OR IGNORE INTO receipt_facts(event_id, device_id, kind, recorded_at) VALUES (?, ?, ?, ?)",
      ).run(eventId, deviceId, state, timestamp);
      this.db.prepare(`UPDATE inbox SET ${column} = COALESCE(${column}, ?) WHERE event_id = ?`).run(timestamp, eventId);
      this.db.exec("COMMIT");
      return { item: this.getItem(eventId), kind, state };
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      if (error instanceof StoreError) throw error;
      throw new StoreError("STORAGE_ERROR", error instanceof Error ? error.message : "storage operation failed", 500);
    }
  }

  inbox(limit = MAX_BATCH): SyncItem[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_BATCH);
    const rows = this.db.prepare(`
      SELECT e.cursor, e.event_id, e.canonical_json, i.delivered_at, i.presented_at,
             i.read_at, i.acknowledged_at
      FROM events e JOIN inbox i ON i.event_id = e.event_id
      ORDER BY e.cursor DESC LIMIT ?
    `).all(boundedLimit) as unknown as SqlRow[];
    return rows.map((row) => this.itemFromRow(row));
  }
}

