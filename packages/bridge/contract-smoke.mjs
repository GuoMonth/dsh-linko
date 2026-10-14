import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNodeServer } from "../node/dist/server.js";

const execFileAsync = promisify(execFile);
const { createDshCompanionBridge, LinkoLocalClient } = await import("./dist/index.js");

const server = createNodeServer({ dbPath: ":memory:", nodeId: "node:bridge-contract" });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.equal(typeof address, "object");
const baseUrl = `http://127.0.0.1:${address.port}`;
const bridge = createDshCompanionBridge({ client: new LinkoLocalClient(baseUrl) });

try {
  const registered = [];
  bridge.register({ registerTool(descriptor, handler) { registered.push({ descriptor, handler }); } });
  assert.deepEqual(registered.map(({ descriptor }) => descriptor.name), ["ask", "inbox", "inspect", "draft", "approve", "reply"]);

  const request = await bridge.ask({
    title: "Review the parser fixture",
    body: "Please inspect the parser fixture and approve a scoped reply.",
    agentId: "agent:fixture",
    delegatedBy: "person:fixture",
    contextRefs: ["project:linko", "fixture:bridge"],
    commandId: "fixture:ask:1",
  });
  assert.match(request.eventId, /^sha256:/);
  assert.equal(request.event.cover.actor.kind, "agent-delegated");

  const inbox = await bridge.inbox();
  assert.equal(inbox.events.length, 1);
  assert.equal(inbox.events[0].id, request.eventId);
  const inspected = await bridge.inspect(request.eventId);
  assert.equal(inspected.eventId, request.eventId);
  assert.equal(inspected.facts.inbox, "delivered");

  const draft = await bridge.draft({ eventId: request.eventId, body: "Approved. I will continue with the scoped parser review." });
  assert.deepEqual(draft.draft.parents, [request.eventId]);
  assert.equal(draft.draft.policy.requiresApproval, false);

  const approval = await bridge.approve({ eventId: request.eventId, actionId: "approve", deviceId: "device:fixture" });
  assert.equal(approval.eventId, request.eventId);
  assert.equal(approval.state, "approved");
  assert.equal(approval.event.facts.action, "approved");

  const reply = await bridge.reply({
    eventId: request.eventId,
    body: "Approved. I will continue with the scoped parser review.",
    commandId: "fixture:reply:1",
  });
  assert.match(reply.eventId, /^sha256:/);
  assert.deepEqual(reply.event.parents, [request.eventId]);
  assert.equal((await bridge.inbox()).events.length, 2);

  const cli = await execFileAsync(process.execPath, [
    "packages/bridge/dist/cli.js",
    "inbox",
    "--base-url",
    baseUrl,
    "--json",
    "{}",
  ], { cwd: new URL("../..", import.meta.url).pathname });
  const cliInbox = JSON.parse(cli.stdout);
  assert.equal(cliInbox.events.length, 2);
  console.log("DSH bridge contract smoke passed: ask -> inbox -> inspect -> draft -> approve -> reply -> CLI inbox");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
