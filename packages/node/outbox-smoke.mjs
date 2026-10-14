import assert from "node:assert/strict";
import { NodeStore } from "./dist/store.js";

const peer = {
  peerId: "peer:test",
  label: "Test peer",
  endpoint: "https://127.0.0.1:1",
  certSha256: "a".repeat(64),
  bearerSecret: "b".repeat(16),
};
const store = new NodeStore({ dbPath: ":memory:", peers: [peer] });
const envelope = {
  kind: "message.human",
  cover: { title: "outbox budget", preview: "test", actor: { kind: "human", id: "person:test" }, status: "message" },
  semantic: { intent: "inform", availableActions: [] },
  policy: { requiresApproval: false },
  nonce: "smoke-nonce",
  createdAt: new Date().toISOString(),
};
const sent = store.send(envelope, peer.peerId, "client:smoke", "command:first");
for (let attempt = 0; attempt < 8; attempt += 1) {
  store.markSending(sent.eventId);
  store.markOutboxResult(sent.eventId, false, "peer offline");
}
assert.equal(store.outbox()[0]?.status, "abandoned");
assert.equal(store.nextOutbox(), null);

// A new explicit command is the visible, bounded way to try again.
store.send(envelope, peer.peerId, "client:smoke", "command:retry");
assert.equal(store.outbox()[0]?.status, "queued");
store.close();
console.log("Outbox smoke passed: finite retry budget -> abandoned -> explicit requeue");
