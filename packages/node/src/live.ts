import type { Server } from "node:http";
import { WebSocketServer, WebSocket, type RawData } from "ws";

// Local UI session limits, independent of the future paired-peer WSS profile.
export const LIVE_LIMITS = {
  clients: 32,
  frameBytes: 4096,
  bufferedBytes: 64 * 1024,
  helloMs: 5000,
  heartbeatMs: 30_000,
  closeMs: 1000,
  coalesceMs: 25,
  messagesPerSecond: 20,
} as const;

interface LiveHubOptions {
  allowedOrigins: readonly string[];
  nodeInfo: () => { nodeId: string; logEpoch: string };
  hostAllowed: (host: string | undefined) => boolean;
}
interface Session {
  ready: boolean;
  alive: boolean;
  count: number;
  windowStart: number;
  helloTimer: NodeJS.Timeout;
  closeTimer?: NodeJS.Timeout;
}

function decode(raw: RawData): Record<string, unknown> | null {
  const bytes = Array.isArray(raw) ? Buffer.concat(raw) : raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

/** Advisory invalidations only. SQLite and REST own all durable state. */
export class LiveHub {
  private readonly clients = new Map<WebSocket, Session>();
  private readonly wss = new WebSocketServer({
    noServer: true, maxPayload: LIVE_LIMITS.frameBytes, clientTracking: false,
    perMessageDeflate: false, autoPong: false,
  });
  private readonly heartbeat: NodeJS.Timeout;
  private hintTimer?: NodeJS.Timeout;
  private closed = false;

  constructor(private readonly options: LiveHubOptions) {
    this.heartbeat = setInterval(() => {
      for (const [client, session] of this.clients) {
        if (!session.ready || client.readyState !== WebSocket.OPEN) continue;
        if (!session.alive) { client.terminate(); continue; }
        session.alive = false;
        client.ping();
      }
    }, LIVE_LIMITS.heartbeatMs);
    this.heartbeat.unref();
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      const reject = (status: string) => socket.end(
        `HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        () => socket.destroy(),
      );
      socket.on("error", () => socket.destroy());
      if (this.closed) { reject("503 Service Unavailable"); return; }
      // This listener owns upgrades. Unknown paths must not leave sockets hanging.
      if (request.url !== "/v1/live") { reject("404 Not Found"); return; }
      const address = request.socket.remoteAddress;
      const local = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
      const origin = request.headers.origin;
      if (!local || !this.options.hostAllowed(request.headers.host)
        || (origin !== undefined && !this.options.allowedOrigins.includes(origin))) {
        reject("403 Forbidden"); return;
      }
      if (this.clients.size >= LIVE_LIMITS.clients) { reject("503 Service Unavailable"); return; }
      this.wss.handleUpgrade(request, socket, head, (client) => this.accept(client));
    });
  }

  private stop(client: WebSocket, code: number, reason: string): void {
    const session = this.clients.get(client);
    if (!session || session.closeTimer) return;
    client.close(code, reason);
    // A broken client may never complete the close handshake.
    session.closeTimer = setTimeout(() => client.terminate(), LIVE_LIMITS.closeMs);
    session.closeTimer.unref();
  }

  private send(client: WebSocket, value: unknown): void {
    if (client.readyState !== WebSocket.OPEN) return;
    const data = JSON.stringify(value);
    if (client.bufferedAmount + Buffer.byteLength(data) > LIVE_LIMITS.bufferedBytes) {
      client.terminate(); return;
    }
    client.send(data, (error) => { if (error) client.terminate(); });
  }

  private accept(client: WebSocket): void {
    const session: Session = {
      ready: false, alive: true, count: 0, windowStart: Date.now(),
      helloTimer: setTimeout(() => this.stop(client, 1002, "hello required"), LIVE_LIMITS.helloMs),
    };
    this.clients.set(client, session);
    const withinBudget = (): boolean => {
      if (Date.now() - session.windowStart >= 1000) { session.windowStart = Date.now(); session.count = 0; }
      if (++session.count <= LIVE_LIMITS.messagesPerSecond) return true;
      this.stop(client, 1008, "message rate exceeded"); return false;
    };
    client.on("message", (raw, binary) => {
      if (client.readyState !== WebSocket.OPEN || !withinBudget()) return;
      const message = binary ? null : decode(raw);
      if (!message) { this.stop(client, 1002, "invalid live message"); return; }
      if (!session.ready) {
        if (message.type !== "hello" || message.protocolVersion !== "v1") {
          this.stop(client, 1002, "hello v1 required"); return;
        }
        session.ready = true;
        clearTimeout(session.helloTimer);
        this.send(client, { type: "ready", protocolVersion: "v1", ...this.options.nodeInfo(), recovery: "GET /v1/sync" });
      } else if (message.type === "ping") {
        this.send(client, { type: "pong" });
      } else {
        this.stop(client, 1002, "unsupported live message");
      }
    });
    client.on("pong", () => { if (withinBudget()) session.alive = true; });
    client.on("ping", (data) => { if (withinBudget() && client.readyState === WebSocket.OPEN) client.pong(data); });
    client.on("close", () => {
      clearTimeout(session.helloTimer);
      clearTimeout(session.closeTimer);
      this.clients.delete(client);
    });
    client.on("error", () => client.terminate());
  }

  /** A burst uses one timer and one constant-size hint, never a queue of events. */
  notify(): void {
    if (this.closed || this.hintTimer || this.clients.size === 0) return;
    this.hintTimer = setTimeout(() => {
      this.hintTimer = undefined;
      for (const [client, session] of this.clients) {
        if (session.ready) this.send(client, { type: "hint" });
      }
    }, LIVE_LIMITS.coalesceMs);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.hintTimer);
    for (const client of this.clients.keys()) this.stop(client, 1001, "server shutting down");
    this.wss.close();
  }
}
