import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest, createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { PeerCertificate } from "node:tls";
import { NodeStore, StoreError, type NodeStoreOptions, type PendingOutbox } from "./store.js";
import { LiveHub } from "./live.js";

const MAX_BODY_BYTES = 1024 * 1024;

export interface NodeServerOptions extends NodeStoreOptions {
  store?: NodeStore;
  allowedOrigins?: readonly string[];
  /** Enable the advisory local live channel. REST remains the recovery path. */
  websocket?: boolean;
}

function json(res: ServerResponse, status: number, value: unknown, origin?: string, allowedOrigins: readonly string[] = []): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (origin !== undefined && allowedOrigins.includes(origin)) { res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "Origin"); }
  res.end(JSON.stringify(value));
}
function errorResponse(res: ServerResponse, error: unknown, origin?: string, allowedOrigins: readonly string[] = []): void {
  if (error instanceof StoreError) { json(res, error.status, { error: { code: error.code, message: error.message, ...error.details } }, origin, allowedOrigins); return; }
  json(res, 500, { error: { code: "INTERNAL_ERROR", message: "internal server error" } }, origin, allowedOrigins);
}
function wireEvent(item: ReturnType<NodeStore["sync"]>["events"][number], store?: NodeStore): Record<string, unknown> {
  const action = Object.values(item.state.actions)[0]?.status ?? "requested";
  const outbound = store?.outboxStatus(item.eventId) ?? "confirmed";
  return {
    ...item.envelope,
    eventId: item.eventId,
    cursor: item.cursor,
    originPeerId: item.originPeerId,
    facts: {
      outbound,
      storage: "usable",
      inbox: item.state.delivered ? "delivered" : "absent",
      acknowledgement: item.state.acknowledgedAt === null ? "absent" : "acknowledged",
      action,
      devices: item.state.devices.map((device) => ({ deviceId: device.deviceId, label: device.deviceId, presentation: device.presentation })),
    },
  };
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); size += buffer.length; if (size > MAX_BODY_BYTES) throw new StoreError("PAYLOAD_TOO_LARGE", `request exceeds ${MAX_BODY_BYTES} bytes`, 413); chunks.push(buffer); }
  if (size === 0) throw new StoreError("INVALID_INPUT", "request body is required");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new StoreError("INVALID_JSON", "request body must be valid JSON"); }
}
function queryLimit(url: URL): number {
  const raw = url.searchParams.get("limit"); if (!raw) return 100; const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new StoreError("INVALID_INPUT", "limit must be a positive integer"); return value;
}
function localHostAllowed(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.startsWith("[") ? value.slice(1, value.indexOf("]")) : value.split(":")[0];
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
function mutationContentType(req: IncomingMessage): void {
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new StoreError("INVALID_CONTENT_TYPE", "mutations require application/json", 415);
}

async function route(req: IncomingMessage, res: ServerResponse, store: NodeStore, allowedOrigins: readonly string[], peerOnly: boolean, liveHub?: LiveHub): Promise<void> {
  if (peerOnly) {
    if (req.method !== "POST" || req.url?.split("?", 1)[0] !== "/v1/peer/events") { json(res, 404, { error: { code: "NOT_FOUND", message: "peer route not found" } }); return; }
    mutationContentType(req);
    const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
    if (!authorization.startsWith("Bearer ")) throw new StoreError("UNAUTHORIZED_PEER", "peer authentication failed", 401);
    const peer = store.peerForSecret(authorization.slice("Bearer ".length));
    const body = await readBody(req); const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const result = store.receivePeer(input.envelope ?? input.event ?? body, input.attemptId, peer.peerId);
    // The recovery fixture sets this process-local delay to stop immediately
    // after durable receipt and exercise the sender's crash boundary. It is
    // unset for normal nodes and has no protocol or production behavior.
    const testAckDelay = Number(process.env.LINKO_TEST_PEER_ACK_DELAY_MS ?? 0);
    if (Number.isInteger(testAckDelay) && testAckDelay > 0) await new Promise((resolve) => setTimeout(resolve, testAckDelay));
    json(res, result.duplicate ? 200 : 201, { eventId: result.eventId, delivery: "confirmed", duplicate: result.duplicate, event: wireEvent(result.item, store) });
    return;
  }
  if (!localHostAllowed(req.headers.host)) throw new StoreError("HOST_NOT_ALLOWED", "local API accepts loopback Host only", 403);
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (origin !== undefined && !allowedOrigins.includes(origin)) throw new StoreError("ORIGIN_NOT_ALLOWED", "Origin is not allowed", 403);
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    if (origin !== undefined) { res.setHeader("access-control-allow-origin", origin); res.setHeader("vary", "Origin"); }
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS"); res.setHeader("access-control-allow-headers", "content-type"); res.end(); return;
  }
  if (req.method === "GET" && url.pathname === "/v1/health") { json(res, 200, { ...store.health(), timestamp: new Date().toISOString() }, origin, allowedOrigins); return; }
  if (req.method === "GET" && url.pathname === "/v1/node") {
    const info = store.nodeInfo();
    if (liveHub) {
      const capabilities = info.capabilities && typeof info.capabilities === "object" ? info.capabilities as Record<string, unknown> : {};
      info.capabilities = { ...capabilities, websocketHints: true };
      info.notes = [...(Array.isArray(info.notes) ? info.notes : []), "WebSocket is an advisory live channel; REST cursor sync remains canonical recovery."];
    }
    json(res, 200, info, origin, allowedOrigins); return;
  }
  if (req.method === "GET" && url.pathname === "/v1/peers") { json(res, 200, { peers: store.peers() }, origin, allowedOrigins); return; }
  if (req.method === "GET" && url.pathname === "/v1/outbox") { json(res, 200, { items: store.outbox(queryLimit(url)) }, origin, allowedOrigins); return; }
  if (req.method === "GET" && url.pathname === "/v1/sync") { const page = store.sync(url.searchParams.get("cursor") ?? undefined, queryLimit(url)); json(res, 200, { ...page, events: page.events.map((item) => wireEvent(item, store)) }, origin, allowedOrigins); return; }
  if (req.method === "GET" && url.pathname === "/v1/inbox") { json(res, 200, { events: store.inbox(queryLimit(url)).map((item) => wireEvent(item, store)) }, origin, allowedOrigins); return; }
  if (req.method === "GET" && url.pathname.startsWith("/v1/inbox/")) { const eventId = decodeURIComponent(url.pathname.slice("/v1/inbox/".length)); json(res, 200, wireEvent(store.getItem(eventId), store), origin, allowedOrigins); return; }
  if (req.method === "POST") mutationContentType(req);
  if (req.method === "POST" && url.pathname === "/v1/envelopes") {
    const body = await readBody(req); const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const result = store.insertEnvelope(input.envelope ?? input.event ?? body, input.attemptId, input.commandId, input.clientId);
    json(res, result.duplicate ? 200 : 201, { eventId: result.eventId, cursor: result.cursor, duplicate: result.duplicate, attemptId: result.attemptId, delivery: "delivered", event: wireEvent(result.item, store), state: result.item.state }, origin, allowedOrigins); return;
  }
  if (req.method === "POST" && url.pathname === "/v1/send") {
    const body = await readBody(req); const input = jsonBody(body); const result = store.send(input.envelope, input.peerId, input.clientId, input.commandId);
    json(res, 202, { eventId: result.eventId, delivery: result.delivery, duplicate: result.duplicate, event: wireEvent(result.item, store) }, origin, allowedOrigins); return;
  }
  if (req.method === "POST" && url.pathname === "/v1/receipts") {
    const result = store.receipt(await readBody(req)); json(res, 200, { ...result, item: result.item, event: wireEvent(result.item, store) }, origin, allowedOrigins); return;
  }
  json(res, 404, { error: { code: "NOT_FOUND", message: "route not found" } }, origin, allowedOrigins);
}
function jsonBody(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : (() => { throw new StoreError("INVALID_INPUT", "request body must be a JSON object"); })(); }

function normalizeFingerprint(value: string): string { return value.replaceAll(":", "").replaceAll(" ", "").toLowerCase(); }
/**
 * Fingerprint pinning identifies the configured peer; it does not replace the
 * certificate validity window. Keep this check explicit because the local
 * profile intentionally disables the system CA check for self-signed leaves.
 */
export function isPeerCertificateValid(cert: Pick<PeerCertificate, "valid_from" | "valid_to">, now = Date.now()): boolean {
  const validFrom = Date.parse(cert.valid_from ?? "");
  const validTo = Date.parse(cert.valid_to ?? "");
  return Number.isFinite(validFrom) && Number.isFinite(validTo) && validFrom <= now && now <= validTo;
}
async function deliver(pending: PendingOutbox, store: NodeStore): Promise<void> {
  const item = store.markSending(pending.item.eventId); const peer = pending.peer; const endpoint = new URL(peer.endpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/v1/peer/events`;
  await new Promise<void>((resolve, reject) => {
    const req = httpsRequest({ hostname: endpoint.hostname, port: endpoint.port || 443, path: `${endpoint.pathname}${endpoint.search}`, method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${peer.bearerSecret}` },
      // Pairing pins the exact certificate. Node's normal CA check cannot
      // validate the self-signed certificates used by the local profile, so
      // the request body is held until the pin check below succeeds.
      rejectUnauthorized: false, timeout: 4000 }, (res) => {
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (chunk) => { const b = Buffer.from(chunk); size += b.length; if (size <= MAX_BODY_BYTES) chunks.push(b); });
      res.on("end", () => { if (size > MAX_BODY_BYTES) { reject(new Error("peer response too large")); return; } if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) { reject(new Error(`peer returned ${res.statusCode ?? 500}`)); return; } resolve(); });
    });
    req.on("socket", (socket) => socket.once("secureConnect", () => {
      const cert = (socket as import("node:tls").TLSSocket).getPeerCertificate();
      if (!isPeerCertificateValid(cert)) {
        req.destroy(new Error("peer certificate is expired or not yet valid"));
        return;
      }
      if (normalizeFingerprint(String(cert.fingerprint256 ?? "")) !== normalizeFingerprint(peer.certSha256)) {
        req.destroy(new Error("peer certificate fingerprint mismatch"));
        return;
      }
      req.end(JSON.stringify({ envelope: pending.envelope, attemptId: `peer:${store.nodeId}:${pending.item.eventId}` }));
    }));
    req.on("timeout", () => req.destroy(new Error("peer request timed out"))); req.on("error", reject);
  }).then(() => {
    if (!store.isClosed) store.markOutboxResult(item.eventId, true);
  }).catch((error: unknown) => {
    // A process can close its listener while one HTTPS request is in flight.
    // Do not turn that normal shutdown race into an uncaught exception; a
    // still-open store records the retry for the next process.
    if (!store.isClosed) store.markOutboxResult(item.eventId, false, error instanceof Error ? error.message : "peer delivery failed");
  });
}
function startDeliveryWorker(server: Server, store: NodeStore): void {
  let running = false;
  const tick = async () => { if (running) return; let pending: PendingOutbox | null; try { pending = store.nextOutbox(); } catch { return; } if (!pending) return; running = true; try { await deliver(pending, store); } finally { running = false; void tick(); } };
  const timer = setInterval(() => void tick(), 100);
  void tick();
  server.on("close", () => clearInterval(timer));
}

export function createNodeServer(options: NodeServerOptions = {}): Server {
  const store = options.store ?? new NodeStore({ dbPath: options.dbPath, nodeId: options.nodeId, peers: options.peers });
  const allowedOrigins = options.allowedOrigins ?? (process.env.LINKO_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? ["http://127.0.0.1:4173", "http://localhost:4173"]);
  const liveHub = options.websocket === false ? undefined : new LiveHub({ allowedOrigins, hostAllowed: localHostAllowed, nodeInfo: () => ({ nodeId: store.nodeId, logEpoch: store.logEpoch }) });
  const server = createServer((req, res) => { route(req, res, store, allowedOrigins, false, liveHub).catch((error: unknown) => errorResponse(res, error, typeof req.headers.origin === "string" ? req.headers.origin : undefined, allowedOrigins)); });
  liveHub?.attach(server);
  const unsubscribe = liveHub ? store.onCommit(() => liveHub.notify()) : () => {};
  const close = server.close.bind(server);
  server.close = (callback) => {
    unsubscribe();
    liveHub?.close();
    return close(callback);
  };
  startDeliveryWorker(server, store);
  server.on("close", () => { if (!options.store) store.close(); });
  return server;
}

/** A separate HTTPS listener exposing only authenticated peer ingress. */
export function createPeerServer(options: NodeServerOptions & { tls: { key: string | Buffer; cert: string | Buffer } }): HttpsServer {
  const store = options.store ?? new NodeStore({ dbPath: options.dbPath, nodeId: options.nodeId, peers: options.peers });
  const server = createHttpsServer({ key: options.tls.key, cert: options.tls.cert }, (req, res) => { route(req, res, store, [], true).catch((error: unknown) => errorResponse(res, error)); });
  server.on("close", () => { if (!options.store) store.close(); });
  return server;
}
