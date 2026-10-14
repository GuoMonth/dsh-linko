import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { actionBinding, reduceActionDecision, type ActionAttempt } from "./action-policy.js";
import type { ActionState, Envelope, EventState, OutboxItem, PeerConfig, SyncItem } from "./types.js";

const MAX_EVENT_BYTES = 1024 * 1024;
const MAX_BATCH = 100;
const MAX_STRING = 4096;
const MAX_OUTBOX_ATTEMPTS = 8;

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
function asRow(value: unknown): SqlRow | undefined { return value && typeof value === "object" ? value as SqlRow : undefined; }
function stringValue(value: unknown, field: string, max = MAX_STRING): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new StoreError("INVALID_INPUT", `${field} must be a non-empty string of at most ${max} characters`);
  return value;
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new StoreError("INVALID_INPUT", "value must be a JSON object");
  return value as Record<string, unknown>;
}
function canonicalize(value: unknown): string { return canonicalizeAt(value, 0); }
function canonicalizeAt(value: unknown, depth: number): string {
  if (depth > 64) throw new StoreError("PAYLOAD_TOO_DEEP", "envelope nesting exceeds 64 levels", 400);
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new StoreError("INVALID_INPUT", "envelope contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalizeAt(item, depth + 1)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalizeAt(object[key], depth + 1)}` ).join(",")}}`;
  }
  throw new StoreError("INVALID_INPUT", "envelope contains an unsupported JSON value");
}
function deriveEventId(value: Record<string, unknown>): string { return `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`; }
function now(): string { return new Date().toISOString(); }
function isActionState(value: string): value is ActionState { return ["requested", "awaiting_approval", "approved", "executing", "succeeded", "failed", "uncertain", "rejected", "expired"].includes(value); }
function asEnvelope(value: unknown, ensureIdentity = false): Envelope {
  const input = jsonObject(value);
  const copy: Record<string, unknown> = { ...input };
  const providedId = typeof copy.id === "string" && copy.id.length > 0 ? copy.id : typeof copy.eventId === "string" && copy.eventId.length > 0 ? copy.eventId : undefined;
  delete copy.eventId;
  delete copy.id;
  delete copy.attemptId;
  delete copy.commandId;
  delete copy.clientId;
  // Facts are independently recorded rows. Never allow a sender to claim receipt/action facts in immutable bytes.
  if (Object.prototype.hasOwnProperty.call(copy, "facts")) throw new StoreError("CLAIMED_FACTS", "immutable envelopes cannot contain claimed facts");
  if (ensureIdentity) {
    if (copy.nonce === undefined) copy.nonce = randomUUID();
    if (copy.createdAt === undefined) copy.createdAt = now();
  }
  // Keep the wire envelope renderable even for the small legacy smoke fixture.
  // New composers should provide these fields explicitly.
  if (copy.cover && typeof copy.cover === "object" && !Array.isArray(copy.cover)) {
    const cover = { ...(copy.cover as Record<string, unknown>) };
    if (!cover.actor) cover.actor = copy.actor && typeof copy.actor === "object" ? copy.actor : { kind: "system", id: "node:unknown" };
    if (cover.status === undefined) cover.status = "unknown";
    copy.cover = cover;
  }
  const canonicalPayload = canonicalize(copy);
  if (Buffer.byteLength(canonicalPayload, "utf8") > MAX_EVENT_BYTES) throw new StoreError("PAYLOAD_TOO_LARGE", `envelope exceeds ${MAX_EVENT_BYTES} bytes`, 413);
  const derivedId = deriveEventId(copy);
  if (providedId !== undefined && providedId !== derivedId) throw new StoreError("EVENT_ID_MISMATCH", "event id does not match canonical payload", 409);
  const envelope = { ...copy, id: derivedId } as Envelope;
  if (Buffer.byteLength(canonicalize(envelope), "utf8") > MAX_EVENT_BYTES) throw new StoreError("PAYLOAD_TOO_LARGE", `envelope exceeds ${MAX_EVENT_BYTES} bytes`, 413);
  return envelope;
}
function decodeEnvelope(value: unknown): Envelope {
  if (typeof value !== "string") throw new StoreError("STORAGE_CORRUPT", "stored envelope is not JSON", 500);
  try { return JSON.parse(value) as Envelope; } catch { throw new StoreError("STORAGE_CORRUPT", "stored envelope is invalid JSON", 500); }
}
function encodeCursor(epoch: string, cursor: number): string { return Buffer.from(JSON.stringify({ epoch, cursor }), "utf8").toString("base64url"); }
function decodeCursor(token: string | undefined, epoch: string, maxCursor: number): number {
  if (!token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as { epoch?: unknown; cursor?: unknown };
    if (parsed.epoch !== epoch) throw new StoreError("CURSOR_RESET", "cursor belongs to a different log epoch", 409, { resetRequired: true, logEpoch: epoch });
    if (typeof parsed.cursor !== "number" || !Number.isSafeInteger(parsed.cursor) || parsed.cursor < 0) throw new Error("invalid cursor");
    if (parsed.cursor > maxCursor) throw new StoreError("CURSOR_RESET", "cursor is ahead of the local log", 409, { resetRequired: true, logEpoch: epoch });
    return parsed.cursor;
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("INVALID_CURSOR", "cursor is not valid", 400);
  }
}
function normalizeFingerprint(value: string): string { return value.replaceAll(":", "").replaceAll(" ", "").toLowerCase(); }
function validatePeerConfig(config: PeerConfig): PeerConfig {
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); } catch { throw new StoreError("CONFIG_INVALID", `peer ${config.peerId} endpoint is invalid`); }
    if (endpoint.protocol !== "https:") throw new StoreError("CONFIG_INVALID", `peer ${config.peerId} endpoint must use https`);
    if ((endpoint.pathname !== "" && endpoint.pathname !== "/") || endpoint.search !== "" || endpoint.hash !== "") throw new StoreError("CONFIG_INVALID", `peer ${config.peerId} endpoint must be the HTTPS origin, without a path or query`);
    if (!/^[a-f0-9]{64}$/.test(normalizeFingerprint(config.certSha256))) throw new StoreError("CONFIG_INVALID", `peer ${config.peerId} certSha256 must be a SHA-256 fingerprint`);
    if (config.bearerSecret.length < 16) throw new StoreError("CONFIG_INVALID", `peer ${config.peerId} bearerSecret is too short`);
  return config;
}
function sendPayloadHash(value: unknown): string {
  const input = jsonObject(value);
  const stable = { ...input };
  delete stable.id; delete stable.eventId; delete stable.nonce; delete stable.createdAt;
  const normalized = asEnvelope(stable, false);
  return createHash("sha256").update(canonicalize(normalized)).digest("hex");
}

export interface NodeStoreOptions { dbPath?: string; nodeId?: string; peers?: readonly PeerConfig[]; clock?: () => string; }
export interface InsertResult { eventId: string; cursor: number; duplicate: boolean; attemptId: string; item: SyncItem; }
export interface SyncResult { events: SyncItem[]; cursor: string; nextCursor: string; hasMore: boolean; logEpoch: string; }
export interface SendResult { eventId: string; item: SyncItem; delivery: "queued" | "confirmed"; duplicate: boolean; }
export interface PendingOutbox { item: OutboxItem; envelope: Envelope; peer: PeerConfig; }

export function readPeerConfig(path: string): PeerConfig[] {
  let parsed: unknown;
  try {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) throw new StoreError("CONFIG_PERMISSIONS", "peer config must be readable only by its owner", 400);
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError("CONFIG_INVALID", "peer config could not be read", 400);
  }
  const root = jsonObject(parsed);
  if (!Array.isArray(root.peers)) throw new StoreError("CONFIG_INVALID", "peer config must contain a peers array", 400);
  return root.peers.map((value, index) => {
    const peer = jsonObject(value);
    const config: PeerConfig = {
      peerId: stringValue(peer.peerId, `peers[${index}].peerId`, 256),
      label: stringValue(peer.label ?? peer.peerId, `peers[${index}].label`, 256),
      endpoint: stringValue(peer.endpoint, `peers[${index}].endpoint`, 2048),
      certSha256: stringValue(peer.certSha256, `peers[${index}].certSha256`, 256),
      bearerSecret: stringValue(peer.bearerSecret, `peers[${index}].bearerSecret`, 4096),
    };
    return validatePeerConfig(config);
  });
}

export class NodeStore {
  readonly db: DatabaseSync;
  readonly dbPath: string;
  private closed = false;
  private readonly commitListeners = new Set<() => void>();
  private readonly clock: () => string;
  private readonly peerMap: Map<string, PeerConfig>;
  constructor(options: NodeStoreOptions = {}) {
    this.dbPath = options.dbPath ?? process.env.LINKO_DB ?? ".linko/node.sqlite";
    this.clock = options.clock ?? now;
    if (this.dbPath !== ":memory:") mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, canonical_json TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox (event_id TEXT PRIMARY KEY REFERENCES events(event_id), delivered_at TEXT NOT NULL, presented_at TEXT, read_at TEXT, acknowledged_at TEXT);
      CREATE TABLE IF NOT EXISTS receipt_facts (event_id TEXT NOT NULL REFERENCES events(event_id), device_id TEXT NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, PRIMARY KEY (event_id, device_id, kind));
      CREATE TABLE IF NOT EXISTS delivery_attempts (attempt_id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(event_id), status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS commands (client_id TEXT NOT NULL, command_id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES events(event_id), payload_hash TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (client_id, command_id));
      CREATE TABLE IF NOT EXISTS actions (event_id TEXT NOT NULL REFERENCES events(event_id), action_id TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, event_digest TEXT, audience TEXT, authority TEXT, policy_version TEXT, device_id TEXT, PRIMARY KEY (event_id, action_id));
      CREATE TABLE IF NOT EXISTS changes (change_cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL REFERENCES events(event_id), kind TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox (event_id TEXT PRIMARY KEY REFERENCES events(event_id), peer_id TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS event_origins (event_id TEXT PRIMARY KEY REFERENCES events(event_id), peer_id TEXT);
    `);
    // Keep databases created by the previous MVP readable. Nullable columns
    // make old action rows fail closed until a complete identity is present.
    const actionColumns = new Set((this.db.prepare("PRAGMA table_info(actions)").all() as unknown as SqlRow[]).map((row) => String(row.name)));
    for (const column of ["event_digest", "audience", "authority", "policy_version", "device_id"]) {
      if (!actionColumns.has(column)) this.db.exec(`ALTER TABLE actions ADD COLUMN ${column} TEXT`);
    }
    const nodeId = options.nodeId ?? process.env.LINKO_NODE_ID ?? `node:${randomUUID()}`;
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('node_id', ?)").run(nodeId);
    this.db.prepare("INSERT OR IGNORE INTO meta(key, value) VALUES ('log_epoch', ?)").run(`epoch:${randomUUID()}`);
    const missing = this.db.prepare("SELECT e.event_id FROM events e LEFT JOIN changes c ON c.event_id = e.event_id WHERE c.event_id IS NULL").all() as unknown as SqlRow[];
    for (const row of missing) this.db.prepare("INSERT INTO changes(event_id, kind, created_at) VALUES (?, 'arrival', ?)").run(String(row.event_id), now());
    this.peerMap = new Map((options.peers ?? []).map((peer) => { const checked = validatePeerConfig(peer); return [checked.peerId, checked] as const; }));
    // A process can die after marking an item sending. Requeue those durable jobs on restart.
    const stale = this.db.prepare("SELECT event_id FROM outbox WHERE status = 'sending'").all() as unknown as SqlRow[];
    for (const row of stale) {
      const eventId = String(row.event_id);
      this.db.prepare("UPDATE outbox SET status = 'retry_wait', next_attempt_at = ?, updated_at = ? WHERE event_id = ?").run(now(), now(), eventId);
      this.addChange(eventId, "outbox_recovered");
    }
  }
  get nodeId(): string { return String(asRow(this.db.prepare("SELECT value FROM meta WHERE key = 'node_id'").get())?.value); }
  get logEpoch(): string { return String(asRow(this.db.prepare("SELECT value FROM meta WHERE key = 'log_epoch'").get())?.value ?? "unknown"); }
  get isClosed(): boolean { return this.closed; }
  close(): void { if (this.closed) return; this.closed = true; this.commitListeners.clear(); this.db.close(); }
  /** Local invalidation after commit, including peer ingress and background jobs.
   * Duplicate commits may also invalidate; observers must never grant authority. */
  onCommit(listener: () => void): () => void {
    this.commitListeners.add(listener);
    return () => { this.commitListeners.delete(listener); };
  }
  private commit(): void {
    this.db.exec("COMMIT");
    for (const listener of this.commitListeners) {
      try { listener(); } catch { /* Advisory observers cannot fail a committed write. */ }
    }
  }
  health(): { status: "ok"; nodeId: string; storage: "sqlite"; logEpoch: string } { this.db.prepare("SELECT 1").get(); return { status: "ok", nodeId: this.nodeId, storage: "sqlite", logEpoch: this.logEpoch }; }
  nodeInfo(): Record<string, unknown> {
    return { nodeId: this.nodeId, protocolVersion: "v1", schemaVersion: 2, logEpoch: this.logEpoch, storage: "sqlite", capabilities: { envelopes: true, receipts: true, cursorSync: true, peers: true, send: true, outbox: true, websocketHints: false }, notes: ["REST is the canonical sync path; peer delivery uses authenticated HTTPS and durable outbox retries."] };
  }
  peers(): Array<{ peerId: string; label: string }> { return [...this.peerMap.values()].map(({ peerId, label }) => ({ peerId, label })); }
  peer(peerId: string): PeerConfig { const peer = this.peerMap.get(stringValue(peerId, "peerId")); if (!peer) throw new StoreError("PEER_NOT_FOUND", "peer is not configured", 404); return peer; }
  peerForSecret(secret: string): PeerConfig {
    const presented = Buffer.from(secret, "utf8");
    for (const peer of this.peerMap.values()) {
      const expected = Buffer.from(peer.bearerSecret, "utf8");
      if (presented.length === expected.length && timingSafeEqual(presented, expected)) return peer;
    }
    throw new StoreError("UNAUTHORIZED_PEER", "peer authentication failed", 401);
  }
  private addChange(eventId: string, kind: string): number {
    this.db.prepare("INSERT INTO changes(event_id, kind, created_at) VALUES (?, ?, ?)").run(eventId, kind, now());
    return Number(asRow(this.db.prepare("SELECT change_cursor FROM changes WHERE rowid = last_insert_rowid()").get())?.change_cursor ?? 0);
  }
  private eventRow(eventId: string): SqlRow {
    const row = asRow(this.db.prepare(`SELECT COALESCE((SELECT MAX(change_cursor) FROM changes c WHERE c.event_id = e.event_id), e.cursor) AS cursor, e.event_id, e.canonical_json, o.peer_id AS origin_peer_id, i.delivered_at, i.presented_at, i.read_at, i.acknowledged_at FROM events e JOIN inbox i ON i.event_id = e.event_id LEFT JOIN event_origins o ON o.event_id = e.event_id WHERE e.event_id = ?`).get(eventId));
    if (!row) throw new StoreError("NOT_FOUND", `event ${eventId} was not found`, 404);
    return row;
  }
  private itemFromRow(row: SqlRow): SyncItem {
    const eventId = String(row.event_id);
    const deviceRows = this.db.prepare("SELECT device_id, kind FROM receipt_facts WHERE event_id = ? ORDER BY device_id").all(eventId) as unknown as SqlRow[];
    const devices = new Map<string, "unseen" | "presented" | "read">();
    for (const fact of deviceRows) {
      const deviceId = String(fact.device_id); const kind = String(fact.kind); const current = devices.get(deviceId) ?? "unseen";
      const next = kind === "read" ? "read" : kind === "presented" && current === "unseen" ? "presented" : current;
      if (next !== "unseen") devices.set(deviceId, next);
    }
    if (devices.size === 0 && (row.presented_at !== null || row.read_at !== null)) devices.set("device:local", row.read_at !== null ? "read" : "presented");
    const actionRows = this.db.prepare("SELECT action_id, status, updated_at FROM actions WHERE event_id = ? ORDER BY action_id").all(eventId) as unknown as SqlRow[];
    const actions: EventState["actions"] = {};
    for (const action of actionRows) actions[String(action.action_id)] = { status: String(action.status) as ActionState, updatedAt: String(action.updated_at) };
    return { id: eventId, eventId, cursor: Number(row.cursor), originPeerId: row.origin_peer_id === null || row.origin_peer_id === undefined ? null : String(row.origin_peer_id), envelope: decodeEnvelope(row.canonical_json), state: { delivered: true, deliveredAt: String(row.delivered_at), presentedAt: row.presented_at === null ? null : String(row.presented_at), readAt: row.read_at === null ? null : String(row.read_at), acknowledgedAt: row.acknowledged_at === null ? null : String(row.acknowledged_at), devices: [...devices.entries()].map(([deviceId, presentation]) => ({ deviceId, presentation })), actions } };
  }
  getItem(eventId: string): SyncItem { return this.itemFromRow(this.eventRow(stringValue(eventId, "eventId"))); }

  private insertEnvelopeTx(value: unknown, attemptId: unknown, commandId: unknown, clientId: unknown, sourcePeerId?: string, ensureIdentity = false, commandPayloadHash?: string): InsertResult {
    const envelope = asEnvelope(value, ensureIdentity); const eventId = envelope.id; const canonical = canonicalize(envelope); const payloadHash = commandPayloadHash ?? createHash("sha256").update(canonical).digest("hex");
    const id = typeof attemptId === "string" && attemptId.length > 0 ? stringValue(attemptId, "attemptId") : `attempt:${randomUUID()}`;
    const command = typeof commandId === "string" && commandId.length > 0 ? stringValue(commandId, "commandId") : undefined;
    const client = typeof clientId === "string" && clientId.length > 0 ? stringValue(clientId, "clientId") : "client:local";
    const timestamp = now();
    const attempt = asRow(this.db.prepare("SELECT event_id FROM delivery_attempts WHERE attempt_id = ?").get(id));
    if (attempt && String(attempt.event_id) !== eventId) throw new StoreError("ATTEMPT_CONFLICT", "attempt id is already bound to another event", 409);
    if (command !== undefined) {
      const previous = asRow(this.db.prepare("SELECT event_id, payload_hash FROM commands WHERE client_id = ? AND command_id = ?").get(client, command));
      if (previous) {
        if (String(previous.payload_hash) !== payloadHash) throw new StoreError("COMMAND_CONFLICT", "command id is already bound to another payload", 409);
        const previousEvent = this.eventRow(String(previous.event_id));
        this.db.prepare("INSERT OR IGNORE INTO delivery_attempts(attempt_id, event_id, status, created_at) VALUES (?, ?, 'accepted_duplicate', ?)").run(id, String(previous.event_id), timestamp);
        return { eventId: String(previous.event_id), cursor: Number(previousEvent.cursor), duplicate: true, attemptId: id, item: this.getItem(String(previous.event_id)) };
      }
    }
    const existing = asRow(this.db.prepare("SELECT cursor, event_id, canonical_json FROM events WHERE event_id = ?").get(eventId));
    if (existing) {
      if (String(existing.canonical_json) !== canonical) throw new StoreError("EVENT_CONFLICT", `event ${eventId} has different canonical bytes`, 409);
      // Record a command even when an earlier arrival did not carry one.
      if (command !== undefined) this.db.prepare("INSERT INTO commands(client_id, command_id, event_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(client, command, eventId, payloadHash, timestamp);
      this.db.prepare("INSERT OR IGNORE INTO delivery_attempts(attempt_id, event_id, status, created_at) VALUES (?, ?, 'accepted_duplicate', ?)").run(id, eventId, timestamp);
      return { eventId, cursor: Number(existing.cursor), duplicate: true, attemptId: id, item: this.getItem(eventId) };
    }
    this.db.prepare("INSERT INTO events(event_id, canonical_json, created_at) VALUES (?, ?, ?)").run(eventId, canonical, timestamp);
    if (command !== undefined) this.db.prepare("INSERT INTO commands(client_id, command_id, event_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?)").run(client, command, eventId, payloadHash, timestamp);
    this.db.prepare("INSERT INTO inbox(event_id, delivered_at) VALUES (?, ?)").run(eventId, timestamp);
    this.db.prepare("INSERT INTO event_origins(event_id, peer_id) VALUES (?, ?)").run(eventId, sourcePeerId ?? null);
    const semantic = envelope.semantic && typeof envelope.semantic === "object" && !Array.isArray(envelope.semantic) ? envelope.semantic as Record<string, unknown> : null;
    const availableActions = semantic && Array.isArray(semantic.availableActions) ? semantic.availableActions.filter((action): action is string => typeof action === "string" && action.length > 0 && action.length <= 256) : [];
    for (const actionId of availableActions) {
      const binding = actionBinding(envelope, eventId, actionId, "");
      this.db.prepare("INSERT OR IGNORE INTO actions(event_id, action_id, status, updated_at, event_digest, audience, authority, policy_version, device_id) VALUES (?, ?, 'requested', ?, ?, ?, ?, ?, NULL)").run(eventId, actionId, timestamp, binding.eventDigest, binding.audience, binding.authority, binding.policyVersion);
    }
    this.db.prepare("INSERT INTO delivery_attempts(attempt_id, event_id, status, created_at) VALUES (?, ?, 'delivered', ?)").run(id, eventId, timestamp);
    const cursor = this.addChange(eventId, "arrival");
    return { eventId, cursor, duplicate: false, attemptId: id, item: this.getItem(eventId) };
  }
  insertEnvelope(value: unknown, attemptId?: unknown, commandId?: unknown, clientId?: unknown, sourcePeerId?: string): InsertResult {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = this.insertEnvelopeTx(value, attemptId, commandId, clientId, sourcePeerId); this.commit(); return result; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* keep original */ } if (error instanceof StoreError) throw error; throw new StoreError("STORAGE_ERROR", "storage operation failed", 500); }
  }
  send(value: unknown, peerIdValue: unknown, clientIdValue: unknown, commandIdValue: unknown): SendResult {
    const peerId = stringValue(peerIdValue, "peerId"); this.peer(peerId);
    const clientId = stringValue(clientIdValue, "clientId"); const commandId = stringValue(commandIdValue, "commandId");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existingCommand = asRow(this.db.prepare("SELECT event_id, payload_hash FROM commands WHERE client_id = ? AND command_id = ?").get(clientId, commandId));
      const hash = sendPayloadHash(value);
      const candidate = asEnvelope(value, true);
      if (existingCommand) {
        if (String(existingCommand.payload_hash) !== hash) throw new StoreError("COMMAND_CONFLICT", "command id is already bound to another payload", 409);
        const existingEventId = String(existingCommand.event_id);
        const existingOutbox = asRow(this.db.prepare("SELECT peer_id, status FROM outbox WHERE event_id = ?").get(existingEventId));
        if (existingOutbox && String(existingOutbox.peer_id) !== peerId) throw new StoreError("OUTBOX_CONFLICT", "event is already queued for another peer", 409);
        if (!existingOutbox) {
          const timestamp = now();
          this.db.prepare("INSERT INTO outbox(event_id, peer_id, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, 'queued', 0, ?, ?, ?)").run(existingEventId, peerId, timestamp, timestamp, timestamp);
          this.addChange(existingEventId, "outbox_queued");
        }
        const existingItem = this.getItem(existingEventId); const out = asRow(this.db.prepare("SELECT status FROM outbox WHERE event_id = ?").get(existingEventId));
        this.commit(); return { eventId: String(existingCommand.event_id), item: existingItem, delivery: out && String(out.status) === "confirmed" ? "confirmed" : "queued", duplicate: true };
      }
      const result = this.insertEnvelopeTx(candidate, undefined, commandId, clientId, undefined, false, hash);
      const timestamp = now();
      const existingOutbox = asRow(this.db.prepare("SELECT peer_id, status FROM outbox WHERE event_id = ?").get(result.eventId));
      if (existingOutbox && String(existingOutbox.peer_id) !== peerId) throw new StoreError("OUTBOX_CONFLICT", "event is already queued for another peer", 409);
      const insertedOutbox = this.db.prepare("INSERT OR IGNORE INTO outbox(event_id, peer_id, status, attempts, next_attempt_at, created_at, updated_at) VALUES (?, ?, 'queued', 0, ?, ?, ?)").run(result.eventId, peerId, timestamp, timestamp, timestamp);
      if (Number(insertedOutbox.changes) > 0) this.addChange(result.eventId, "outbox_queued");
      if (existingOutbox && ["abandoned", "rejected"].includes(String(existingOutbox.status))) {
        this.db.prepare("UPDATE outbox SET status = 'queued', attempts = 0, next_attempt_at = ?, last_error = NULL, updated_at = ? WHERE event_id = ?").run(timestamp, timestamp, result.eventId);
        this.addChange(result.eventId, "outbox_requeued");
      }
      const outbox = asRow(this.db.prepare("SELECT status FROM outbox WHERE event_id = ?").get(result.eventId));
      this.commit();
      return { eventId: result.eventId, item: this.getItem(result.eventId), delivery: outbox && String(outbox.status) === "confirmed" ? "confirmed" : "queued", duplicate: result.duplicate };
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* keep original */ } if (error instanceof StoreError) throw error; throw new StoreError("STORAGE_ERROR", "storage operation failed", 500); }
  }
  receivePeer(value: unknown, attemptId: unknown, peerId: string): InsertResult { return this.insertEnvelope(value, attemptId, undefined, `peer:${peerId}`, peerId); }

  sync(token?: string, limit = MAX_BATCH): SyncResult {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_BATCH); const epoch = this.logEpoch;
    const maxCursor = Number(asRow(this.db.prepare("SELECT MAX(change_cursor) AS max_cursor FROM changes").get())?.max_cursor ?? 0); const start = decodeCursor(token, epoch, maxCursor);
    const rows = this.db.prepare("SELECT change_cursor, event_id FROM changes WHERE change_cursor > ? ORDER BY change_cursor LIMIT ?").all(start, boundedLimit + 1) as unknown as SqlRow[];
    const hasMore = rows.length > boundedLimit; const pageRows = hasMore ? rows.slice(0, boundedLimit) : rows;
    // A projection is returned once per event per page, while the cursor still advances over every independent change.
    const items = new Map<string, SyncItem>();
    for (const row of pageRows) { const item = this.getItem(String(row.event_id)); item.cursor = Number(row.change_cursor); items.set(item.eventId, item); }
    const end = pageRows.length > 0 ? Number(pageRows[pageRows.length - 1].change_cursor) : start; const nextCursor = encodeCursor(epoch, end);
    return { events: [...items.values()], cursor: nextCursor, nextCursor, hasMore, logEpoch: epoch };
  }

  receipt(input: unknown): { item: SyncItem; kind: string; state: string; actionId?: string } {
    const body = jsonObject(input); const eventId = stringValue(body.eventId ?? body.id, "eventId"); const state = stringValue(body.state, "state");
    const deviceId = typeof body.deviceId === "string" && body.deviceId.length > 0 ? stringValue(body.deviceId, "deviceId", 256) : "device:local";
    if (!["presented", "read", "acknowledged", "approved", "rejected"].includes(state)) throw new StoreError("INVALID_INPUT", `unsupported receipt state ${state}`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const item = this.getItem(eventId); const timestamp = this.clock();
      if (state === "approved" || state === "rejected") {
        const semantic = item.envelope.semantic; const available = semantic && typeof semantic === "object" && !Array.isArray(semantic) && Array.isArray((semantic as Record<string, unknown>).availableActions) ? (semantic as Record<string, unknown>).availableActions as unknown[] : [];
        const actionId = typeof body.actionId === "undefined"
          ? available.length === 1
            ? stringValue(available[0], "availableActions[0]", 256)
            : available.includes("primary")
              ? "primary"
              : (() => { throw new StoreError("ACTION_REQUIRED", "actionId is required when an envelope offers multiple actions", 400); })()
          : stringValue(body.actionId, "actionId", 256);
        if (!available.includes(actionId)) throw new StoreError("ACTION_NOT_REQUESTED", "action is not requested by this envelope", 409);
        const existing = asRow(this.db.prepare("SELECT status, event_digest, audience, authority, policy_version, device_id FROM actions WHERE event_id = ? AND action_id = ?").get(eventId, actionId));
        if (!existing) throw new StoreError("ACTION_NOT_REQUESTED", "action request state is missing", 409);
        const binding = actionBinding(item.envelope, eventId, actionId, deviceId);
        const previous: ActionAttempt | null = existing ? {
          status: String(existing.status) as ActionState,
          binding: {
            eventDigest: existing.event_digest === null || existing.event_digest === undefined ? eventId : String(existing.event_digest),
            actionId,
            audience: existing.audience === null || existing.audience === undefined ? null : String(existing.audience),
            authority: existing.authority === null || existing.authority === undefined ? null : String(existing.authority),
            policyVersion: existing.policy_version === null || existing.policy_version === undefined ? null : String(existing.policy_version),
            deviceId: existing.device_id === null || existing.device_id === undefined ? "" : String(existing.device_id),
          },
        } : null;
        const decision = reduceActionDecision({ eventDigest: eventId, envelope: item.envelope, actionId, decision: state as "approved" | "rejected", deviceId, at: timestamp, previous });
        if (!decision.ok) throw new StoreError(decision.code, decision.message, decision.code === "INVALID_INPUT" ? 400 : 409);
        if (!decision.duplicate) {
          this.db.prepare("INSERT INTO actions(event_id, action_id, status, updated_at, event_digest, audience, authority, policy_version, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id, action_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at, event_digest = excluded.event_digest, audience = excluded.audience, authority = excluded.authority, policy_version = excluded.policy_version, device_id = excluded.device_id").run(eventId, actionId, state, timestamp, binding.eventDigest, binding.audience, binding.authority, binding.policyVersion, binding.deviceId);
          this.addChange(eventId, "action");
        }
        this.commit(); return { item: this.getItem(eventId), kind: "action", state, actionId };
      }
      const column = state === "presented" ? "presented_at" : state === "read" ? "read_at" : "acknowledged_at";
      const result = this.db.prepare("INSERT OR IGNORE INTO receipt_facts(event_id, device_id, kind, recorded_at) VALUES (?, ?, ?, ?)").run(eventId, deviceId, state, timestamp);
      this.db.prepare(`UPDATE inbox SET ${column} = COALESCE(${column}, ?) WHERE event_id = ?`).run(timestamp, eventId);
      if (Number(result.changes) > 0) this.addChange(eventId, `receipt_${state}`);
      this.commit(); return { item: this.getItem(eventId), kind: state, state };
    } catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* keep original */ } if (error instanceof StoreError) throw error; throw new StoreError("STORAGE_ERROR", "storage operation failed", 500); }
  }
  inbox(limit = MAX_BATCH): SyncItem[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_BATCH); const rows = this.db.prepare("SELECT e.event_id FROM events e JOIN inbox i ON i.event_id = e.event_id ORDER BY e.cursor DESC LIMIT ?").all(boundedLimit) as unknown as SqlRow[]; return rows.map((row) => this.getItem(String(row.event_id)));
  }
  outboxStatus(eventId: string): OutboxItem["status"] | null {
    const row = asRow(this.db.prepare("SELECT status FROM outbox WHERE event_id = ?").get(eventId));
    return row ? String(row.status) as OutboxItem["status"] : null;
  }
  outbox(limit = MAX_BATCH): OutboxItem[] {
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), MAX_BATCH); const rows = this.db.prepare("SELECT event_id, peer_id, status, attempts, next_attempt_at, last_error FROM outbox ORDER BY created_at LIMIT ?").all(boundedLimit) as unknown as SqlRow[];
    return rows.map((row) => ({ eventId: String(row.event_id), peerId: String(row.peer_id), status: String(row.status) as OutboxItem["status"], attempts: Number(row.attempts), nextAttemptAt: row.next_attempt_at === null ? null : String(row.next_attempt_at), ...(row.last_error ? { lastError: String(row.last_error) } : {}) }));
  }
  nextOutbox(): PendingOutbox | null {
    const row = asRow(this.db.prepare("SELECT event_id, peer_id, status, attempts, next_attempt_at, last_error FROM outbox WHERE status IN ('queued', 'retry_wait') AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT 1").get(now()));
    if (!row) return null; const peer = this.peer(String(row.peer_id)); const item: OutboxItem = { eventId: String(row.event_id), peerId: String(row.peer_id), status: String(row.status) as OutboxItem["status"], attempts: Number(row.attempts), nextAttemptAt: row.next_attempt_at === null ? null : String(row.next_attempt_at), ...(row.last_error ? { lastError: String(row.last_error) } : {}) }; return { item, envelope: this.getItem(item.eventId).envelope, peer };
  }
  markSending(eventId: string): OutboxItem {
    this.db.exec("BEGIN IMMEDIATE"); try { const row = asRow(this.db.prepare("SELECT attempts, peer_id FROM outbox WHERE event_id = ?").get(eventId)); if (!row) throw new StoreError("OUTBOX_NOT_FOUND", "outbox item was not found", 404); const attempts = Number(row.attempts) + 1; const timestamp = now(); this.db.prepare("UPDATE outbox SET status = 'sending', attempts = ?, updated_at = ?, last_error = NULL WHERE event_id = ?").run(attempts, timestamp, eventId); this.addChange(eventId, "outbox_sending"); this.commit(); return { eventId, peerId: String(row.peer_id), status: "sending", attempts, nextAttemptAt: null }; } catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* keep original */ } if (error instanceof StoreError) throw error; throw new StoreError("STORAGE_ERROR", "storage operation failed", 500); }
  }
  markOutboxResult(eventId: string, ok: boolean, errorMessage?: string): OutboxItem {
    this.db.exec("BEGIN IMMEDIATE"); try { const row = asRow(this.db.prepare("SELECT peer_id, attempts FROM outbox WHERE event_id = ?").get(eventId)); if (!row) throw new StoreError("OUTBOX_NOT_FOUND", "outbox item was not found", 404); const attempts = Number(row.attempts); const timestamp = now(); if (ok) this.db.prepare("UPDATE outbox SET status = 'confirmed', next_attempt_at = NULL, updated_at = ?, last_error = NULL WHERE event_id = ?").run(timestamp, eventId); else if (attempts >= MAX_OUTBOX_ATTEMPTS) this.db.prepare("UPDATE outbox SET status = 'abandoned', next_attempt_at = NULL, updated_at = ?, last_error = ? WHERE event_id = ?").run(timestamp, (errorMessage ?? "peer delivery failed; retry budget exhausted").slice(0, 256), eventId); else { const delay = Math.min(30_000, 250 * (2 ** Math.min(attempts - 1, 7))); const next = new Date(Date.now() + delay).toISOString(); this.db.prepare("UPDATE outbox SET status = 'retry_wait', next_attempt_at = ?, updated_at = ?, last_error = ? WHERE event_id = ?").run(next, timestamp, (errorMessage ?? "peer delivery failed").slice(0, 256), eventId); } this.addChange(eventId, ok ? "outbox_confirmed" : attempts >= MAX_OUTBOX_ATTEMPTS ? "outbox_abandoned" : "outbox_retry"); this.commit(); const result = asRow(this.db.prepare("SELECT event_id, peer_id, status, attempts, next_attempt_at, last_error FROM outbox WHERE event_id = ?").get(eventId)); if (!result) throw new StoreError("STORAGE_ERROR", "outbox result disappeared", 500); return { eventId: String(result.event_id), peerId: String(result.peer_id), status: String(result.status) as OutboxItem["status"], attempts: Number(result.attempts), nextAttemptAt: result.next_attempt_at === null ? null : String(result.next_attempt_at), ...(result.last_error ? { lastError: String(result.last_error) } : {}) }; } catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* keep original */ } if (error instanceof StoreError) throw error; throw new StoreError("STORAGE_ERROR", "storage operation failed", 500); }
  }
}
