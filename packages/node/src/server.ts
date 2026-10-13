import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { NodeStore, StoreError } from "./store.js";

const MAX_BODY_BYTES = 1024 * 1024;

export interface NodeServerOptions {
  store?: NodeStore;
  dbPath?: string;
  nodeId?: string;
  allowedOrigins?: readonly string[];
}

function json(res: ServerResponse, status: number, value: unknown, origin?: string, allowedOrigins: readonly string[] = []): void {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  if (origin !== undefined && allowedOrigins.includes(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  res.end(body);
}

function errorResponse(res: ServerResponse, error: unknown, origin?: string, allowedOrigins: readonly string[] = []): void {
  if (error instanceof StoreError) {
    json(res, error.status, { error: { code: error.code, message: error.message, ...error.details } }, origin, allowedOrigins);
    return;
  }
  json(res, 500, { error: { code: "INTERNAL_ERROR", message: "internal server error" } }, origin, allowedOrigins);
}

function wireEvent(item: ReturnType<NodeStore["sync"]>["events"][number]): Record<string, unknown> {
  const currentFacts = item.envelope.facts && typeof item.envelope.facts === "object" && !Array.isArray(item.envelope.facts)
    ? item.envelope.facts as Record<string, unknown>
    : {};
  const action = Object.values(item.state.actions)[0]?.status ?? currentFacts.action ?? "requested";
  return {
    ...item.envelope,
    eventId: item.eventId,
    cursor: item.cursor,
    facts: {
      ...currentFacts,
      outbound: currentFacts.outbound ?? "confirmed",
      storage: currentFacts.storage ?? "usable",
      inbox: item.state.delivered ? "delivered" : "absent",
      acknowledgement: item.state.acknowledgedAt === null ? "absent" : "acknowledged",
      action,
      devices: item.state.devices.map((device) => ({
        deviceId: device.deviceId,
        label: device.deviceId,
        presentation: device.presentation,
      })),
    },
  };
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new StoreError("PAYLOAD_TOO_LARGE", `request exceeds ${MAX_BODY_BYTES} bytes`, 413);
    chunks.push(buffer);
  }
  if (size === 0) throw new StoreError("INVALID_INPUT", "request body is required");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StoreError("INVALID_JSON", "request body must be valid JSON");
  }
}

function queryLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (!raw) return 100;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new StoreError("INVALID_INPUT", "limit must be a positive integer");
  return value;
}

async function route(req: IncomingMessage, res: ServerResponse, store: NodeStore, allowedOrigins: readonly string[]): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    if (origin !== undefined && allowedOrigins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    res.end();
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/health") {
    json(res, 200, { ...store.health(), timestamp: new Date().toISOString() }, origin, allowedOrigins);
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/node") {
    json(res, 200, store.nodeInfo(), origin, allowedOrigins);
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/sync") {
    const page = store.sync(url.searchParams.get("cursor") ?? undefined, queryLimit(url));
    json(res, 200, { ...page, events: page.events.map(wireEvent) }, origin, allowedOrigins);
    return;
  }
  if (req.method === "GET" && url.pathname === "/v1/inbox") {
    json(res, 200, { events: store.inbox(queryLimit(url)).map(wireEvent) }, origin, allowedOrigins);
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/v1/inbox/")) {
    const eventId = decodeURIComponent(url.pathname.slice("/v1/inbox/".length));
    json(res, 200, wireEvent(store.getItem(eventId)), origin, allowedOrigins);
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/envelopes") {
    const body = await readBody(req);
    const input = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const envelope = input.envelope ?? input.event ?? body;
    const result = store.insertEnvelope(envelope, input.attemptId, input.commandId, input.clientId);
    json(res, result.duplicate ? 200 : 201, {
      eventId: result.eventId,
      cursor: result.cursor,
      duplicate: result.duplicate,
      attemptId: result.attemptId,
      delivery: "delivered",
      event: wireEvent(result.item),
      state: result.item.state,
    }, origin, allowedOrigins);
    return;
  }
  if (req.method === "POST" && url.pathname === "/v1/receipts") {
    const result = store.receipt(await readBody(req));
    json(res, 200, { ...result, item: result.item, event: wireEvent(result.item) }, origin, allowedOrigins);
    return;
  }
  json(res, 404, { error: { code: "NOT_FOUND", message: "route not found" } }, origin, allowedOrigins);
}

export function createNodeServer(options: NodeServerOptions = {}): Server {
  const store = options.store ?? new NodeStore({ dbPath: options.dbPath, nodeId: options.nodeId });
  const allowedOrigins = options.allowedOrigins ?? (process.env.LINKO_ALLOWED_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [
    "http://127.0.0.1:4173",
    "http://localhost:4173",
  ]);
  const server = createServer((req, res) => {
    route(req, res, store, allowedOrigins).catch((error: unknown) => errorResponse(res, error, typeof req.headers.origin === "string" ? req.headers.origin : undefined, allowedOrigins));
  });
  server.on("close", () => {
    if (!options.store) store.close();
  });
  return server;
}

