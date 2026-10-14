#!/usr/bin/env node
import { LIVE_LIMITS, LiveHints, liveUrl } from '../dist/live.js';
import { SyncQueue } from '../dist/sync.js';

let checks = 0;
let failures = 0;
function check(label, value) {
  checks += 1;
  if (value) console.log(`  ok   ${label}`);
  else { failures += 1; console.log(`  FAIL ${label}`); }
}
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

class Clock {
  now = 0;
  next = 1;
  timers = new Map();
  setTimeout(callback, delay) { const id = this.next++; this.timers.set(id, { at: this.now + delay, callback }); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  advance(ms) {
    this.now += ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= this.now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

class FakeSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  closed = false;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  closeFromPeer() { this.readyState = 3; this.onclose?.(); }
}

const clock = new Clock();
const sockets = [];
let ready = 0;
let hints = 0;
let disconnects = 0;
const live = new LiveHints({
  base: 'https://127.0.0.1:8787/',
  createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
  clock,
  random: () => 0,
  onReady: () => ready += 1,
  onHint: () => hints += 1,
  onDisconnect: () => disconnects += 1,
});

check('http bases map to ws', liveUrl('http://127.0.0.1:8787') === 'ws://127.0.0.1:8787/v1/live');
check('https bases map to wss', liveUrl('https://127.0.0.1:8787/') === 'wss://127.0.0.1:8787/v1/live');
live.updateNode({ nodeId: 'node-a', protocolVersion: 'v1', logEpoch: 'epoch-a', websocketHints: true });
const first = sockets[0];
first.open();
check('hello is the only first frame', first.sent.length === 1 && first.sent[0].type === 'hello' && first.sent[0].protocolVersion === 'v1');
first.receive({ type: 'ready', protocolVersion: 'v1', nodeId: 'node-a', logEpoch: 'epoch-a', recovery: 'GET /v1/sync' });
check('ready enables the live session', ready === 1);
first.receive({ type: 'hint', reason: 'append' });
first.receive({ type: 'hint', reason: 'append' });
check('hints are advisory callbacks', hints === 2);
clock.advance(LIVE_LIMITS.heartbeatMs);
check('heartbeat sends ping', first.sent.at(-1)?.type === 'ping');
first.receive({ type: 'pong' });
check('pong keeps a healthy session open', !first.closed && disconnects === 0);
first.closeFromPeer();
check('socket loss is surfaced once', disconnects === 1);
clock.advance(LIVE_LIMITS.reconnectBaseMs);
check('reconnect uses explicit backoff', sockets.length === 2);
const timeoutSockets = [];
const timeoutClock = new Clock();
const timeoutLive = new LiveHints({
  base: 'http://127.0.0.1:8787',
  createSocket: () => { const socket = new FakeSocket(); timeoutSockets.push(socket); return socket; },
  clock: timeoutClock,
  random: () => 0,
  onReady() {}, onHint() {}, onDisconnect() {},
});
timeoutLive.updateNode({ nodeId: 'node-a', protocolVersion: 'v1', logEpoch: 'epoch-a', websocketHints: true });
timeoutClock.advance(LIVE_LIMITS.handshakeMs);
check('handshake timeout closes an unready socket', timeoutSockets[0].closed === true);
timeoutLive.pause();
timeoutClock.advance(LIVE_LIMITS.reconnectBaseMs);
check('pause suppresses handshake reconnect', timeoutSockets.length === 1);
timeoutLive.resume();
check('resume retries after page cleanup', timeoutSockets.length === 2);
timeoutLive.dispose();
live.dispose();
clock.advance(LIVE_LIMITS.reconnectMaxMs);
check('dispose prevents reconnect', sockets.length === 2);

const unavailable = new LiveHints({ base: 'http://127.0.0.1:8787', createSocket: null, clock, onReady() {}, onHint() {}, onDisconnect() {} });
unavailable.updateNode({ nodeId: 'node-a', protocolVersion: 'v1', logEpoch: 'epoch-a', websocketHints: false });
check('capability fallback makes no socket', sockets.length === 2);

let factoryCalls = 0;
const capabilityFallback = new LiveHints({
  base: 'http://127.0.0.1:8787',
  createSocket: () => { factoryCalls += 1; return new FakeSocket(); },
  clock,
  onReady() {}, onHint() {}, onDisconnect() {},
});
capabilityFallback.updateNode({ nodeId: 'node-a', protocolVersion: 'v1', logEpoch: 'epoch-a', websocketHints: false });
check('false capability does not call a non-null socket factory', factoryCalls === 0);

const watchdogClock = new Clock();
const watchdogSockets = [];
let watchdogDisconnects = 0;
const watchdog = new LiveHints({
  base: 'http://127.0.0.1:8787',
  createSocket: () => { const socket = new FakeSocket(); watchdogSockets.push(socket); return socket; },
  clock: watchdogClock,
  random: () => 0,
  onReady() {}, onHint() {}, onDisconnect: () => watchdogDisconnects += 1,
});
watchdog.updateNode({ nodeId: 'node-a', protocolVersion: 'v1', logEpoch: 'epoch-a', websocketHints: true });
watchdogSockets[0].open();
watchdogSockets[0].receive({ type: 'ready', protocolVersion: 'v1', nodeId: 'node-a', logEpoch: 'epoch-a', recovery: 'GET /v1/sync' });
watchdogClock.advance(LIVE_LIMITS.heartbeatMs);
check('watchdog sends a heartbeat ping', watchdogSockets[0].sent.at(-1)?.type === 'ping');
watchdogClock.advance(LIVE_LIMITS.pongTimeoutMs);
check('watchdog closes a socket with no pong', watchdogSockets[0].closed === true && watchdogDisconnects === 1);
watchdog.dispose();

const loopClock = new Clock();
const loopSockets = [];
const reconnect = new LiveHints({
  base: 'http://127.0.0.1:8787',
  createSocket: () => { const socket = new FakeSocket(); loopSockets.push(socket); return socket; },
  clock: loopClock,
  random: () => 1,
  onReady() {}, onHint() {}, onDisconnect() {},
});
reconnect.updateNode({ nodeId: 'node-a', protocolVersion: 'v1', logEpoch: 'epoch-a', websocketHints: true });
for (let index = 0; index < 8; index += 1) {
  const socket = loopSockets.at(-1);
  socket.open();
  socket.receive({ type: 'ready', protocolVersion: 'v1', nodeId: 'node-a', logEpoch: 'epoch-a', recovery: 'GET /v1/sync' });
  socket.closeFromPeer();
  loopClock.advance(LIVE_LIMITS.reconnectMaxMs);
}
check('ready/close reconnect loop remains bounded', loopSockets.length === 9);
reconnect.dispose();

const syncClock = new Clock();
let runs = 0;
let active = 0;
let overlap = 0;
let releaseRun;
const queue = new SyncQueue(async () => {
  runs += 1;
  active += 1;
  if (active > 1) overlap += 1;
  await new Promise((resolve) => { releaseRun = resolve; });
  active -= 1;
}, () => {}, syncClock);
const firstRun = queue.request();
syncClock.advance(100);
await flush();
queue.request();
queue.request();
check('coalescing bounds an in-flight burst to one run', runs === 1 && active === 1);
releaseRun();
await flush();
syncClock.advance(100);
await flush();
check('queued requests cause exactly one subsequent run without overlap', runs === 2 && overlap === 0 && active === 1);
releaseRun();
await firstRun;

let failed = true;
let runFailures = 0;
const recoveryClock = new Clock();
const recoveryQueue = new SyncQueue(async () => {
  if (failed) { failed = false; throw new Error('expected test failure'); }
}, () => { runFailures += 1; }, recoveryClock);
const failedRun = recoveryQueue.request();
recoveryClock.advance(100);
await flush();
await failedRun;
const recoveredRun = recoveryQueue.request();
recoveryClock.advance(100);
await flush();
await recoveredRun;
check('a failed run settles and a later request recovers', runFailures === 1);

const pauseClock = new Clock();
let releasePaused;
let pauseRuns = 0;
const pauseQueue = new SyncQueue(async () => {
  pauseRuns += 1;
  await new Promise((resolve) => { releasePaused = resolve; });
}, () => {}, pauseClock);
let settled = false;
const inFlight = pauseQueue.request().then(() => { settled = true; });
pauseClock.advance(100);
await flush();
pauseQueue.pause();
releasePaused();
await inFlight;
check('pause settles an in-flight request promise after the run completes', pauseRuns === 1 && settled);
pauseQueue.resume();
const resumed = pauseQueue.request();
pauseClock.advance(100);
// The resumed run blocks until its release, proving resume really schedules work.
await flush();
releasePaused();
await resumed;
check('resume schedules a new reconciliation after pause', pauseRuns === 2);

console.log(`\n${checks - failures}/${checks} checks passed.`);
if (failures > 0) process.exitCode = 1;
