import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { WebSocket } from 'ws';
import { createNodeServer, createPeerServer, isPeerCertificateValid } from './dist/server.js';
import { NodeStore } from './dist/store.js';
import { LIVE_LIMITS } from './dist/live.js';

const origin = 'http://127.0.0.1:4173';
const sockets = new Set();
const servers = new Set();
const stores = [];
const work = mkdtempSync(join(tmpdir(), 'linko-live-'));
const deadline = (ms = 2500) => AbortSignal.timeout(ms);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(server) {
  servers.add(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function request(base, path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', signal: deadline(),
    headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  assert.equal(response.ok, true, JSON.stringify(value));
  return value;
}
async function connect(base, hello = true) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/v1/live', { origin });
  sockets.add(ws);
  const messages = [];
  const waiters = new Set();
  ws.on('error', () => {});
  ws.on('message', (raw) => {
    const value = JSON.parse(raw.toString()); messages.push(value);
    for (const wake of waiters) wake();
  });
  const take = (type, ms = 2500) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiters.delete(wake); reject(new Error(`missing ${type}`)); }, ms);
    function wake() {
      const i = messages.findIndex((m) => m.type === type);
      if (i < 0) return;
      clearTimeout(timer); waiters.delete(wake); resolve(messages.splice(i, 1)[0]);
    }
    waiters.add(wake); wake();
  });
  await once(ws, 'open', { signal: deadline() });
  const client = { ws, take, messages };
  if (hello) {
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 'v1' }));
    const ready = await take('ready');
    assert.equal(ready.recovery, 'GET /v1/sync');
    assert.equal(ready.protocolVersion, 'v1');
    assert.equal(typeof ready.nodeId, 'string');
  }
  return client;
}
async function closeClient(client) {
  const ended = once(client.ws, 'close', { signal: deadline() });
  client.ws.close(); await ended;
}
async function rejectedUpgrade(base, path, headers, status) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + path, { headers });
  sockets.add(ws);
  ws.on('error', () => {});
  const [req, response] = await once(ws, 'unexpected-response', { signal: deadline() });
  assert.equal(response.statusCode, status);
  response.resume(); req.destroy(); ws.terminate();
}
async function closedFor(base, payload, expected, hello = false) {
  const client = await connect(base, hello);
  const ended = once(client.ws, 'close', { signal: deadline() });
  client.ws.send(payload);
  const [code] = await ended;
  assert.equal(code, expected);
}
const envelope = (title) => ({ kind: 'message.note', cover: { title, preview: title }, semantic: { intent: 'inform', availableActions: [] } });

try {
  const store = new NodeStore({ dbPath: ':memory:' }); stores.push(store);
  const server = createNodeServer({ store, allowedOrigins: [origin] });
  const base = await listen(server);
  assert.equal((await request(base, '/v1/node')).capabilities.websocketHints, true);
  await rejectedUpgrade(base, '/v1/live', { origin: 'https://untrusted.invalid' }, 403);
  await rejectedUpgrade(base, '/v1/live', { origin, host: 'untrusted.invalid' }, 403);
  await rejectedUpgrade(base, '/missing', { origin }, 404);

  // No hints before version negotiation. Ready always requires REST catch-up.
  const client = await connect(base, false);
  store.insertEnvelope(envelope('before hello'));
  await pause(LIVE_LIMITS.coalesceMs * 3);
  assert.equal(client.messages.length, 0);
  client.ws.send(JSON.stringify({ type: 'hello', protocolVersion: 'v1' }));
  await client.take('ready');
  let page = await request(base, '/v1/sync');
  assert.equal(page.events.length, 1);
  client.ws.send(JSON.stringify({ type: 'ping' }));
  assert.deepEqual(await client.take('pong'), { type: 'pong' });

  const created = await request(base, '/v1/envelopes', envelope('committed'));
  assert.deepEqual(await client.take('hint'), { type: 'hint' });
  page = await request(base, `/v1/sync?cursor=${encodeURIComponent(page.nextCursor)}`);
  assert.equal(page.events[0].eventId, created.eventId);
  await request(base, '/v1/receipts', { eventId: created.eventId, state: 'read', deviceId: 'device:test' });
  await client.take('hint');
  page = await request(base, `/v1/sync?cursor=${encodeURIComponent(page.nextCursor)}`);
  assert.equal(page.events[0].facts.devices[0].presentation, 'read');

  // Roll back after INSERT, rather than testing only input validation failure.
  let commits = 0;
  const unsubscribe = store.onCommit(() => { commits += 1; });
  store.db.exec("CREATE TEMP TRIGGER fail_arrival BEFORE INSERT ON changes WHEN NEW.kind = 'arrival' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END");
  assert.throws(() => store.insertEnvelope(envelope('rolled back')));
  store.db.exec('DROP TRIGGER fail_arrival');
  assert.equal(commits, 0);
  await pause(LIVE_LIMITS.coalesceMs * 3);
  assert.equal(client.messages.length, 0);
  assert.equal(store.sync(page.nextCursor).events.length, 0);
  unsubscribe();
  const brokenObserver = store.onCommit(() => { throw new Error('advisory observer failed'); });
  store.insertEnvelope(envelope('observer cannot reject a commit'));
  brokenObserver(); await client.take('hint');

  // A burst has no event queue; all missing facts come from paginated REST.
  for (let i = 0; i < 110; i++) store.insertEnvelope(envelope(`burst-${i}`));
  await client.take('hint');
  assert.equal(client.messages.length, 0);
  const ids = new Set();
  do {
    page = await request(base, `/v1/sync?limit=20&cursor=${encodeURIComponent(page.nextCursor)}`);
    for (const event of page.events) ids.add(event.eventId);
  } while (page.hasMore);
  assert.equal(ids.size, 111);

  await closeClient(client);
  const savedCursor = page.nextCursor;
  const offline = store.insertEnvelope(envelope('missed while disconnected'));
  store.insertEnvelope(offline.item.envelope); // same event identity, retried
  const resumed = await connect(base);
  page = await request(base, `/v1/sync?cursor=${encodeURIComponent(savedCursor)}`);
  assert.deepEqual(page.events.map((event) => event.eventId), [offline.eventId]);
  assert.equal((await request(base, `/v1/sync?cursor=${encodeURIComponent(page.nextCursor)}`)).events.length, 0);
  await closeClient(resumed);

  await closedFor(base, '{bad json', 1002);
  await closedFor(base, JSON.stringify({ type: 'hello', protocolVersion: 'v2' }), 1002);
  await closedFor(base, JSON.stringify({ type: 'ping' }), 1002);
  await closedFor(base, Buffer.from('{}'), 1002);
  await closedFor(base, 'x'.repeat(LIVE_LIMITS.frameBytes + 1), 1009);
  const rate = await connect(base);
  const rateClosed = once(rate.ws, 'close', { signal: deadline() });
  for (let i = 0; i < LIVE_LIMITS.messagesPerSecond + 1; i++) rate.ws.send('{"type":"ping"}');
  assert.equal((await rateClosed)[0], 1008);

  const idle = await connect(base, false);
  assert.equal((await once(idle.ws, 'close', { signal: deadline(LIVE_LIMITS.helloMs + 2000) }))[0], 1002);
  const capped = [];
  for (let i = 0; i < LIVE_LIMITS.clients; i++) capped.push(await connect(base));
  await rejectedUpgrade(base, '/v1/live', { origin }, 503);
  const closes = capped.map(({ ws }) => once(ws, 'close', { signal: deadline() }));
  await new Promise((resolve) => server.close(resolve)); servers.delete(server);
  for (const result of await Promise.all(closes)) assert.equal(result[0], 1001);

  // Real paired HTTPS ingress shares the receiver store, and sender delivery
  // results happen in the background, outside local HTTP mutation handlers.
  const now = Date.now();
  assert.equal(isPeerCertificateValid({ valid_from: new Date(now - 1000).toISOString(), valid_to: new Date(now + 1000).toISOString() }, now), true);
  assert.equal(isPeerCertificateValid({ valid_from: new Date(now - 2000).toISOString(), valid_to: new Date(now - 1000).toISOString() }, now), false);
  assert.equal(isPeerCertificateValid({ valid_from: new Date(now + 1000).toISOString(), valid_to: new Date(now + 2000).toISOString() }, now), false);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', '-keyout', join(work, 'key'), '-out', join(work, 'cert')], { stdio: 'ignore' });
  const key = readFileSync(join(work, 'key')); const cert = readFileSync(join(work, 'cert'));
  const pin = new X509Certificate(cert).fingerprint256;
  const secret = 'live-fixture-secret-12345';
  const receiverStore = new NodeStore({ dbPath: ':memory:', peers: [{ peerId: 'sender', label: 'sender', endpoint: 'https://127.0.0.1:1', certSha256: pin, bearerSecret: secret }] }); stores.push(receiverStore);
  const peer = createPeerServer({ store: receiverStore, tls: { key, cert } });
  const peerBase = (await listen(peer)).replace('http:', 'https:');
  const receiverBase = await listen(createNodeServer({ store: receiverStore, allowedOrigins: [origin] }));
  const receiver = await connect(receiverBase);
  const senderStore = new NodeStore({ dbPath: ':memory:', peers: [{ peerId: 'receiver', label: 'receiver', endpoint: peerBase, certSha256: pin, bearerSecret: secret }] }); stores.push(senderStore);
  const senderBase = await listen(createNodeServer({ store: senderStore, allowedOrigins: [origin] }));
  const sender = await connect(senderBase);
  const sent = await request(senderBase, '/v1/send', { peerId: 'receiver', envelope: envelope('peer ingress'), clientId: 'fixture', commandId: 'send-1' });
  await receiver.take('hint');
  assert.equal((await request(receiverBase, '/v1/inbox')).events[0].eventId, sent.eventId);
  // Each check is driven by a hint; no polling can conceal a missing background signal.
  let confirmed = false;
  for (let i = 0; i < 5 && !confirmed; i++) {
    await sender.take('hint');
    confirmed = (await request(senderBase, '/v1/outbox')).items[0].status === 'confirmed';
  }
  assert.equal(confirmed, true);
  const disabledBase = await listen(createNodeServer({ dbPath: ':memory:', websocket: false }));
  assert.equal((await request(disabledBase, '/v1/node')).capabilities.websocketHints, false);
  console.log('Node live smoke passed: guarded handshake, commit hints, rollback silence, bounded sessions, REST gap recovery, HTTPS ingress and outbox wakeups');
} finally {
  for (const ws of sockets) ws.terminate();
  await Promise.all([...servers].map((server) => new Promise((resolve) => server.close(resolve))));
  for (const store of stores) store.close();
  rmSync(work, { recursive: true, force: true });
}
