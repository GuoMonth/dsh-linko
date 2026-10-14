import assert from "node:assert/strict";
import { createNodeServer } from "./dist/server.js";

const server = createNodeServer({ dbPath: ":memory:", nodeId: "node:smoke" });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;

async function request(path, options) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  return body;
}

const envelope = {
  kind: "collaboration.request",
  cover: { title: "Smoke approval", preview: "Approve a local action" },
  semantic: { intent: "request", availableActions: ["approve"] },
  policy: { requiresApproval: true },
};
const first = await request("/v1/envelopes", { method: "POST", body: JSON.stringify(envelope) });
const duplicate = await request("/v1/envelopes", { method: "POST", body: JSON.stringify(envelope) });
assert.equal(first.duplicate, false);
assert.equal(duplicate.duplicate, true);
assert.match(first.eventId, /^sha256:/);

const page = await request("/v1/sync", { method: "GET" });
assert.equal(page.events.length, 1);
assert.equal(page.events[0].eventId, first.eventId);

const read = await request("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: first.eventId, deviceId: "device:smoke", state: "read" }),
});
assert.equal(read.item.state.readAt !== null, true);
assert.equal(read.item.state.presentedAt, null);
assert.equal(read.item.state.devices[0].presentation, "read");
const approval = await request("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: first.eventId, state: "approved" }),
});
assert.equal(approval.item.state.actions.approve.status, "approved");

const next = await request(`/v1/sync?cursor=${encodeURIComponent(page.nextCursor)}`, { method: "GET" });
assert.equal(next.events.length, 1);
assert.equal(next.events[0].eventId, first.eventId);
assert.equal(next.events[0].facts.devices[0].presentation, "read");
const health = await request("/v1/health", { method: "GET" });
assert.equal(health.storage, "sqlite");
console.log("Linko smoke passed: write -> duplicate delivery -> sync cursor -> read -> action approval");
await new Promise((resolve) => server.close(resolve));

