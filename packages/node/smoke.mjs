import assert from "node:assert/strict";
import { reduceActionDecision } from "./dist/action-policy.js";
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
async function requestError(path, options, code) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
  });
  const body = await response.json();
  assert.equal(response.ok, false, `expected ${code} but request succeeded: ${JSON.stringify(body)}`);
  assert.equal(body.error?.code, code, JSON.stringify(body));
  return body;
}

const envelope = {
  kind: "collaboration.request",
  cover: { title: "Smoke approval", preview: "Approve a local action" },
  semantic: { intent: "request", availableActions: ["approve"] },
  policy: { requiresApproval: true, expiresAt: null, audience: "team:smoke", authority: { principalId: "person:smoke" }, version: 1 },
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
  body: JSON.stringify({ eventId: first.eventId, deviceId: "device:smoke", state: "approved" }),
});
assert.equal(approval.item.state.actions.approve.status, "approved");

const next = await request(`/v1/sync?cursor=${encodeURIComponent(page.nextCursor)}`, { method: "GET" });
assert.equal(next.events.length, 1);
assert.equal(next.events[0].eventId, first.eventId);
assert.equal(next.events[0].facts.devices[0].presentation, "read");

// A terminal decision is idempotent only for the exact same action identity.
const duplicateApproval = await request("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: first.eventId, deviceId: "device:smoke", actionId: "approve", state: "approved" }),
});
assert.equal(duplicateApproval.item.state.actions.approve.status, "approved");
await requestError("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: first.eventId, deviceId: "device:smoke", actionId: "approve", state: "rejected" }),
}, "INVALID_TRANSITION");
await requestError("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: first.eventId, deviceId: "device:other", actionId: "approve", state: "approved" }),
}, "ACTION_IDENTITY_MISMATCH");

// Approval is fail-closed when the envelope has no requested action, even if
// a client supplies a familiar action identifier.
const noRequest = await request("/v1/envelopes", {
  method: "POST",
  body: JSON.stringify({ kind: "collaboration.request", semantic: { intent: "request", availableActions: [] }, policy: { requiresApproval: true } }),
});
await requestError("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: noRequest.eventId, actionId: "approve", state: "approved" }),
}, "ACTION_NOT_REQUESTED");
const noApprovalPolicy = await request("/v1/envelopes", {
  method: "POST",
  body: JSON.stringify({ kind: "collaboration.request", semantic: { intent: "request", availableActions: ["approve"] }, policy: { requiresApproval: false } }),
});
await requestError("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: noApprovalPolicy.eventId, actionId: "approve", state: "approved" }),
}, "APPROVAL_NOT_REQUIRED");

// A malformed expiry cannot be bypassed by an approval receipt.
const malformedExpiry = await request("/v1/envelopes", {
  method: "POST",
  body: JSON.stringify({ kind: "collaboration.request", semantic: { intent: "request", availableActions: ["approve"] }, policy: { requiresApproval: true, expiresAt: "tomorrow-ish" } }),
});
await requestError("/v1/receipts", {
  method: "POST",
  body: JSON.stringify({ eventId: malformedExpiry.eventId, actionId: "approve", state: "approved" }),
}, "POLICY_INVALID_EXPIRY");

// Exact expiry is expired (the boundary is >=, not >) and is deterministic
// because the pure reducer receives its evaluation timestamp explicitly.
const boundaryAt = "2026-01-01T00:00:00.000Z";
const boundary = reduceActionDecision({
  eventDigest: "sha256:boundary",
  envelope: { semantic: { availableActions: ["approve"] }, policy: { requiresApproval: true, expiresAt: boundaryAt }, id: "sha256:boundary" },
  actionId: "approve",
  decision: "approved",
  deviceId: "device:smoke",
  at: boundaryAt,
  previous: null,
});
assert.equal(boundary.ok, false);
assert.equal(boundary.code, "APPROVAL_EXPIRED");
const invalidTime = reduceActionDecision({
  eventDigest: "sha256:boundary",
  envelope: { semantic: { availableActions: ["approve"] }, policy: { requiresApproval: true }, id: "sha256:boundary" },
  actionId: "approve",
  decision: "approved",
  deviceId: "device:smoke",
  at: "0",
  previous: null,
});
assert.equal(invalidTime.ok, false);
assert.equal(invalidTime.code, "INVALID_INPUT");

const health = await request("/v1/health", { method: "GET" });
assert.equal(health.storage, "sqlite");
console.log("Linko smoke passed: write -> duplicate delivery -> sync cursor -> read -> action approval");
await new Promise((resolve) => server.close(resolve));

