import type { NodeInfo } from './api.js';
import { browserClock, type TimerClock } from './sync.js';

export const LIVE_LIMITS = {
  handshakeMs: 5_000,
  heartbeatMs: 15_000,
  pongTimeoutMs: 10_000,
  reconnectBaseMs: 500,
  reconnectMaxMs: 30_000,
  maxMessageChars: 4_096,
  maxBufferedBytes: 4_096,
} as const;

type Socket = Pick<WebSocket, 'readyState' | 'bufferedAmount' | 'send' | 'close' | 'onopen' | 'onmessage' | 'onerror' | 'onclose'>;
export interface LiveOptions {
  base: string;
  onReady: () => void;
  onHint: () => void;
  onDisconnect: () => void;
  createSocket?: ((url: string) => Socket) | null;
  clock?: TimerClock;
  random?: () => number;
}

/** Same API base, including any configured proxy prefix; never a peer endpoint. */
export function liveUrl(base: string): string {
  const url = new URL(`${base.replace(/\/+$/, '')}/v1/live`);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid-live-base');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** Advisory wakeups only: this class cannot hold an envelope or advance a cursor. */
export class LiveHints {
  private readonly clock: TimerClock;
  private readonly random: () => number;
  private readonly createSocket: ((url: string) => Socket) | null;
  private socket: Socket | null = null;
  private node: NodeInfo | null = null;
  private paused = false;
  private disposed = false;
  private ready = false;
  private failures = 0;
  private retryTimer: number | undefined;
  private handshakeTimer: number | undefined;
  private heartbeatTimer: number | undefined;
  private watchdogTimer: number | undefined;

  constructor(private readonly options: LiveOptions) {
    this.clock = options.clock ?? browserClock;
    this.random = options.random ?? Math.random;
    this.createSocket = options.createSocket === undefined
      ? (typeof WebSocket === 'undefined' ? null : (url) => new WebSocket(url))
      : options.createSocket;
  }

  updateNode(node: NodeInfo | null): void {
    const changed = this.node?.nodeId !== node?.nodeId || this.node?.logEpoch !== node?.logEpoch;
    this.node = node;
    if (changed || !this.enabled()) {
      this.stop();
      this.failures = 0;
    }
    this.connect();
  }

  pause(): void { this.paused = true; this.stop(); }
  resume(): void { this.paused = false; this.connect(); }
  dispose(): void { this.disposed = true; this.stop(); }

  private enabled(): boolean {
    return !this.paused && !this.disposed && this.createSocket !== null
      && this.node?.protocolVersion === 'v1' && this.node.websocketHints;
  }

  private connect(): void {
    if (!this.enabled() || this.socket !== null || this.retryTimer !== undefined) return;
    let socket: Socket;
    try { socket = this.createSocket!(liveUrl(this.options.base)); }
    catch { this.retry(); return; }
    this.socket = socket;
    this.handshakeTimer = this.clock.setTimeout(() => this.lost(socket), LIVE_LIMITS.handshakeMs);
    socket.onopen = () => {
      if (this.socket === socket) this.send(socket, { type: 'hello', protocolVersion: 'v1' });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.message(socket, event.data);
    };
    socket.onerror = socket.onclose = () => this.lost(socket);
  }

  private message(socket: Socket, data: unknown): void {
    if (typeof data !== 'string' || data.length > LIVE_LIMITS.maxMessageChars) { this.lost(socket); return; }
    let value: unknown;
    try { value = JSON.parse(data); } catch { this.lost(socket); return; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { this.lost(socket); return; }
    const message = value as Record<string, unknown>;
    if (!this.ready) {
      if (message.type !== 'ready' || message.protocolVersion !== 'v1'
        || message.recovery !== 'GET /v1/sync'
        || typeof message.nodeId !== 'string' || message.nodeId.length === 0 || message.nodeId.length > 512
        || typeof message.logEpoch !== 'string' || message.logEpoch.length === 0 || message.logEpoch.length > 512) {
        this.lost(socket);
        return;
      }
      // Ready identity is advisory too. REST re-reads identity and handles epoch resets.
      this.ready = true;
      this.clearTimer('handshakeTimer');
      this.armHeartbeat(socket);
      this.options.onReady();
      return;
    }
    if (message.type === 'hint') this.options.onHint();
    else if (message.type === 'ping') this.send(socket, { type: 'pong' });
    else if (message.type === 'pong') {
      if (this.watchdogTimer === undefined) return;
      this.clearTimer('watchdogTimer');
      // A ready/close loop must still back off; only a heartbeat proves stability.
      this.failures = 0;
      this.armHeartbeat(socket);
    } else this.lost(socket);
  }

  private armHeartbeat(socket: Socket): void {
    this.clearTimer('heartbeatTimer');
    this.heartbeatTimer = this.clock.setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.socket !== socket || !this.send(socket, { type: 'ping' })) return;
      this.watchdogTimer = this.clock.setTimeout(() => this.lost(socket), LIVE_LIMITS.pongTimeoutMs);
    }, LIVE_LIMITS.heartbeatMs);
  }

  private send(socket: Socket, value: object): boolean {
    if (socket.readyState !== 1 || socket.bufferedAmount > LIVE_LIMITS.maxBufferedBytes) {
      this.lost(socket);
      return false;
    }
    try { socket.send(JSON.stringify(value)); return true; }
    catch { this.lost(socket); return false; }
  }

  private lost(socket: Socket): void {
    if (this.socket !== socket) return;
    const wasReady = this.ready;
    this.stop();
    if (wasReady) this.options.onDisconnect();
    this.retry();
  }

  private retry(): void {
    if (!this.enabled() || this.retryTimer !== undefined) return;
    const cap = Math.min(LIVE_LIMITS.reconnectMaxMs, LIVE_LIMITS.reconnectBaseMs * 2 ** Math.min(this.failures++, 16));
    // Equal jitter: [cap/2, cap], capped at 30 s even after prolonged failure.
    const delay = Math.floor(cap * (0.5 + this.random() * 0.5));
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, delay);
  }

  private clearTimer(name: 'retryTimer' | 'handshakeTimer' | 'heartbeatTimer' | 'watchdogTimer'): void {
    const timer = this[name];
    if (timer !== undefined) this.clock.clearTimeout(timer);
    this[name] = undefined;
  }

  private stop(): void {
    for (const name of ['retryTimer', 'handshakeTimer', 'heartbeatTimer', 'watchdogTimer'] as const) this.clearTimer(name);
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (socket !== null) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(); } catch { /* Already closed by the browser. */ }
    }
  }
}
