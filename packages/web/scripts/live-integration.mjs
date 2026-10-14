#!/usr/bin/env node
/**
 * Module-level loopback integration: the real node server, native Node WebSocket,
 * and the browser client's REST/live modules. No DOM or browser renderer is used.
 * Build the node and web packages first (`pnpm node:build && pnpm web:build`).
 */
import assert from 'node:assert/strict';
import { NodeStore } from '../../node/dist/store.js';
import { createNodeServer } from '../../node/dist/server.js';
import { fetchEnvelopes, fetchNode } from '../dist/api.js';
import { mergeEnvelopes } from '../dist/model.js';
import { LiveHints } from '../dist/live.js';
import { SyncQueue } from '../dist/sync.js';

// Node 24 exposes the browser-compatible WebSocket globally.
const NativeWebSocket = globalThis.WebSocket;
if (typeof NativeWebSocket !== 'function') throw new Error('native WebSocket is unavailable; Node 24 is required');

const clock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};

function waitFor(predicate, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() >= deadline) { reject(new Error(`timed out waiting for ${label}`)); return; }
      setTimeout(check, 20);
    };
    check();
  });
}

async function postEnvelope(base, title) {
  const response = await fetch(`${base}/v1/envelopes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      envelope: {
        actor: { kind: 'human', id: 'integration-test' },
        cover: { title, preview: title, actor: { kind: 'human', id: 'integration-test' } },
        body: { text: title },
      },
    }),
  });
  assert.equal(response.status, 201);
  return await response.json();
}

const store = new NodeStore({ dbPath: ':memory:', nodeId: 'integration-node' });
const server = createNodeServer({ store });
let live;
let queue;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const node = await fetchNode(base);
  assert.equal(node?.websocketHints, true);

  let cursor = null;
  let envelopes = [];
  let syncRuns = 0;
  let activeRuns = 0;
  let maximumActiveRuns = 0;
  const syncErrors = [];
  const reconcile = async () => {
    syncRuns += 1;
    activeRuns += 1;
    maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
    try {
      let pageCursor = cursor;
      while (true) {
        const outcome = await fetchEnvelopes(base, pageCursor);
        if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.detail}`);
        envelopes = mergeEnvelopes(envelopes, outcome.value.envelopes);
        cursor = outcome.value.cursor;
        if (!outcome.value.hasMore) break;
        pageCursor = cursor;
      }
    } finally {
      activeRuns -= 1;
    }
  };
  queue = new SyncQueue(reconcile, (error) => syncErrors.push(error), clock);
  const sockets = [];
  let readyCount = 0;
  let hintCount = 0;
  let disconnectCount = 0;
  live = new LiveHints({
    base,
    clock,
    createSocket: (url) => {
      const socket = new NativeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
    onReady: () => { readyCount += 1; void queue.request(); },
    onHint: () => { hintCount += 1; void queue.request(); },
    onDisconnect: () => { disconnectCount += 1; void queue.request(); },
  });
  live.updateNode(node);
  await queue.request();
  await waitFor(() => readyCount === 1, 'initial live ready');
  assert.equal(syncErrors.length, 0);
  const first = await postEnvelope(base, 'live-hint-one');
  await waitFor(() => hintCount >= 1, 'first live hint');
  await waitFor(() => envelopes.some((envelope) => envelope.id === first.eventId), 'REST merge after hint');
  assert.equal(maximumActiveRuns, 1);
  const firstId = first.eventId;

  sockets.at(-1).close();
  await waitFor(() => disconnectCount === 1, 'socket disconnect callback');
  const missed = await postEnvelope(base, 'live-hint-missed-while-closed');
  await waitFor(() => readyCount >= 2, 'live reconnect ready');
  await waitFor(() => envelopes.some((envelope) => envelope.id === missed.eventId), 'REST recovery after reconnect');
  const ids = envelopes.map((envelope) => envelope.id);
  assert.equal(new Set(ids).size, ids.length, 'live and REST paths must deduplicate envelopes');
  assert.ok(ids.includes(firstId));
  assert.ok(syncRuns >= 3, 'initial, hint, and reconnect REST reconciliation should run');
  assert.equal(maximumActiveRuns, 1, 'REST reconciliation must never overlap');
  assert.equal(syncErrors.length, 0);
  const socketCountBeforeShutdown = sockets.length;
  const activeSocket = sockets.at(-1);
  live.dispose();
  await waitFor(() => activeSocket.readyState === 3, 'live socket shutdown');
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(sockets.length, socketCountBeforeShutdown, 'shutdown must suppress reconnect');
  console.log(`live integration passed (${syncRuns} REST runs, ${hintCount} hints, ${ids.length} unique events)`);
} finally {
  live?.dispose();
  queue?.pause();
  await new Promise((resolve) => server.close(resolve));
  store.close();
}
