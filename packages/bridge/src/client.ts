import { randomUUID } from "node:crypto";
import type {
  BridgeResult,
  InboxResult,
  LinkoEvent,
  LinkoLocalClientOptions,
  ApprovalResult,
} from "./types.js";

export const DEFAULT_LOCAL_API = "http://127.0.0.1:8787";
const DEFAULT_TIMEOUT_MS = 4_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class LinkoBridgeError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly detail?: unknown;

  constructor(code: string, message: string, status: number | null = null, detail?: unknown) {
    super(message);
    this.name = "LinkoBridgeError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function localBase(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new LinkoBridgeError("INVALID_LOCAL_URL", "baseUrl must be a valid HTTP URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LinkoBridgeError("INVALID_LOCAL_URL", "baseUrl must use http or https");
  }
  if (!isLoopback(parsed.hostname)) {
    throw new LinkoBridgeError("NON_LOCAL_URL", "the DSH bridge only accepts a loopback Linko API");
  }
  if (parsed.username || parsed.password || (parsed.pathname !== "" && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new LinkoBridgeError("INVALID_LOCAL_URL", "baseUrl must be a loopback origin without credentials, path, or query");
  }
  return parsed.origin;
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LinkoBridgeError("INVALID_NODE_RESPONSE", `${context} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function event(value: unknown, context: string): LinkoEvent {
  const record = object(value, context);
  if (typeof record.id !== "string" || record.id.length === 0) {
    throw new LinkoBridgeError("INVALID_NODE_RESPONSE", `${context} is missing an event id`);
  }
  return record as LinkoEvent;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function errorPayload(value: unknown): { code: string; message: string; detail?: unknown } {
  const record = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const nested = record.error !== null && typeof record.error === "object" && !Array.isArray(record.error) ? record.error as Record<string, unknown> : {};
  return {
    code: typeof nested.code === "string" && nested.code.length <= 80 ? nested.code : "NODE_ERROR",
    message: typeof nested.message === "string" && nested.message.length <= 300 ? nested.message : "Linko local API request failed",
    ...(nested.details === undefined ? {} : { detail: nested.details }),
  };
}

/**
 * The bridge's replaceable client face. It talks to one loopback Linko node;
 * peer discovery and peer transport remain node responsibilities.
 */
export class LinkoLocalClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(baseOrOptions: string | LinkoLocalClientOptions = {}) {
    const options = typeof baseOrOptions === "string" ? { baseUrl: baseOrOptions } : baseOrOptions;
    this.baseUrl = localBase(options.baseUrl ?? DEFAULT_LOCAL_API);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0 ? Math.floor(options.timeoutMs as number) : DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = Number.isFinite(options.maxResponseBytes) && (options.maxResponseBytes ?? 0) > 0 ? Math.floor(options.maxResponseBytes as number) : DEFAULT_MAX_RESPONSE_BYTES;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { accept: "application/json", ...(init.body === undefined ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LinkoBridgeError("LOCAL_API_UNREACHABLE", "the Linko local API could not be reached", null, error instanceof Error ? error.message : undefined);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > this.maxResponseBytes) {
      throw new LinkoBridgeError("NODE_RESPONSE_TOO_LARGE", "the Linko response exceeds the bridge limit", response.status);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) {
      throw new LinkoBridgeError("NODE_RESPONSE_TOO_LARGE", "the Linko response exceeds the bridge limit", response.status);
    }
    let payload: unknown;
    try {
      payload = text.length === 0 ? {} : JSON.parse(text) as unknown;
    } catch {
      throw new LinkoBridgeError("INVALID_NODE_RESPONSE", "the Linko response was not valid JSON", response.status);
    }
    if (!response.ok) {
      const failure = errorPayload(payload);
      throw new LinkoBridgeError(failure.code, failure.message, response.status, failure.detail);
    }
    return object(payload, "Linko response");
  }

  async createEnvelope(envelope: Record<string, unknown>, options: {
    readonly targetPeerId?: string;
    readonly clientId?: string;
    readonly commandId?: string;
  } = {}): Promise<BridgeResult> {
    const target = options.targetPeerId;
    const path = target === undefined ? "/v1/envelopes" : "/v1/send";
    const body = target === undefined
      ? { envelope, ...(options.clientId === undefined ? {} : { clientId: options.clientId }), ...(options.commandId === undefined ? {} : { commandId: options.commandId }) }
      : {
        peerId: target,
        envelope,
        clientId: options.clientId ?? "dsh-linko-bridge",
        commandId: options.commandId ?? `bridge:${randomUUID()}`,
      };
    const payload = await this.request(path, { method: "POST", body: JSON.stringify(body) });
    const wire = event(payload.event ?? payload.item, "Linko event");
    const eventId = typeof payload.eventId === "string" ? payload.eventId : wire.id;
    return {
      event: wire,
      eventId,
      duplicate: payload.duplicate === true,
      delivery: stringOrNull(payload.delivery),
    };
  }

  async inbox(limit?: number): Promise<InboxResult> {
    const suffix = limit === undefined ? "" : `?limit=${encodeURIComponent(String(limit))}`;
    const payload = await this.request(`/v1/inbox${suffix}`);
    if (!Array.isArray(payload.events)) throw new LinkoBridgeError("INVALID_NODE_RESPONSE", "Linko inbox response is missing events");
    return { events: payload.events.map((value, index) => event(value, `Linko inbox event ${index}`)) };
  }

  async inspect(eventId: string): Promise<LinkoEvent> {
    const payload = await this.request(`/v1/inbox/${encodeURIComponent(eventId)}`);
    return event(payload, "Linko inspected event");
  }

  async approve(eventId: string, actionId?: string, deviceId?: string): Promise<ApprovalResult> {
    const payload = await this.request("/v1/receipts", {
      method: "POST",
      body: JSON.stringify({ eventId, state: "approved", ...(actionId === undefined ? {} : { actionId }), ...(deviceId === undefined ? {} : { deviceId }) }),
    });
    const wire = event(payload.event ?? payload.item, "Linko approval event");
    return {
      event: wire,
      eventId: typeof payload.eventId === "string" ? payload.eventId : (wire.eventId ?? wire.id),
      state: typeof payload.state === "string" ? payload.state : "approved",
      actionId: typeof payload.actionId === "string" ? payload.actionId : (actionId ?? "approve"),
    };
  }
}
