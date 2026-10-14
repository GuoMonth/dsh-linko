import assert from "node:assert/strict";
import { createNodeServer } from "./dist/server.js";

const server = createNodeServer({ dbPath: ":memory:", nodeId: "node:contract" });
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

const created = await request("/v1/envelopes", {
  method: "POST",
  body: JSON.stringify({
    kind: "message.note",
    cover: { title: "Cross-package contract", preview: "The UI must see this cover." },
    semantic: { intent: "request", availableActions: ["approve", "reject"] },
    policy: { requiresApproval: true },
  }),
});
const page = await request("/v1/sync");
assert.equal((await fetch(`${base}/v1/node`, { headers: { origin: "http://127.0.0.1:4173" } })).headers.get("access-control-allow-origin"), "http://127.0.0.1:4173");
assert.equal(page.events.length, 1);
assert.equal(page.events[0].id, created.eventId);
assert.equal(typeof page.events[0].cover.title, "string");
assert.ok(Array.isArray(page.events[0].facts.devices));

const model = await import(new URL("../../packages/web/dist/model.js", import.meta.url));
const parsed = model.parseEnvelopeBatch(page);
assert.equal(parsed.envelopes.length, 1);
assert.equal(parsed.skipped, 0);
assert.equal(parsed.envelopes[0].id, created.eventId);

const receipt = await request("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: created.eventId, actionId: "approve", state: "approved", deviceId: "device:web" }),
});
assert.equal(receipt.item.eventId, created.eventId);
assert.equal(receipt.item.state.actions.approve.status, "approved");

console.log("Cross-package contract smoke passed: node sync -> web parser -> approval");
await new Promise((resolve) => server.close(resolve));
