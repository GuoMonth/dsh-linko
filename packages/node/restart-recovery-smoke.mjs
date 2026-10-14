import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";

const root = join(import.meta.dirname, "..", "..");
const work = mkdtempSync(join(tmpdir(), "linko-recovery-"));
const certDir = join(work, "cert");
mkdirSync(certDir);
const keyPath = join(certDir, "node-b.key");
const certPath = join(certDir, "node-b.crt");
const aDb = join(work, "node-a.sqlite");
const bDb = join(work, "node-b.sqlite");
const aPeers = join(work, "peers-a.json");
const bPeers = join(work, "peers-b.json");
const secret = "recovery-fixture-secret-123";
const event = {
  kind: "message.human",
  cover: { title: "forced restart", preview: "durable recovery", actor: { kind: "human", id: "person:fixture" }, status: "message" },
  semantic: { intent: "inform", availableActions: [] },
  policy: { requiresApproval: false },
  nonce: "recovery-fixture-nonce",
  createdAt: new Date().toISOString(),
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}
function fingerprint(path) {
  const output = execFileSync("openssl", ["x509", "-in", path, "-noout", "-fingerprint", "-sha256"], { encoding: "utf8" });
  return output.trim().split("=")[1].replaceAll(":", "");
}
function makeCertificate() {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", keyPath, "-out", certPath], { stdio: "ignore" });
  chmodSync(keyPath, 0o600);
  return fingerprint(certPath);
}
function writePeers(path, peer) {
  writeFileSync(path, JSON.stringify({ peers: [peer] }));
  chmodSync(path, 0o600);
}
function startNode(env) {
  const child = spawn(process.execPath, [join(root, "packages/node/dist/cli.js")], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.debugOutput = () => output;
  return child;
}
async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}
async function request(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json();
  assert.equal(response.ok, true, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}
function stopHard(child) {
  if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
}
async function exited(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

let nodeA;
let nodeB;
try {
  const certSha256 = makeCertificate();
  const [aPort, bPort, bPeerPort] = await Promise.all([freePort(), freePort(), freePort()]);
  const peerB = { peerId: "node-b", label: "Node B", endpoint: `https://127.0.0.1:${bPeerPort}`, certSha256, bearerSecret: secret };
  const peerA = { peerId: "node-a", label: "Node A", endpoint: "https://127.0.0.1:1", certSha256, bearerSecret: secret };
  writePeers(aPeers, peerB);
  writePeers(bPeers, peerA);
  const aEnv = { LINKO_DB: aDb, LINKO_NODE_ID: "node-a", LINKO_PORT: String(aPort), LINKO_PEERS_FILE: aPeers };
  const bEnv = { LINKO_DB: bDb, LINKO_NODE_ID: "node-b", LINKO_PORT: String(bPort), LINKO_PEER_PORT: String(bPeerPort), LINKO_PEERS_FILE: bPeers, LINKO_TLS_KEY: keyPath, LINKO_TLS_CERT: certPath, LINKO_TEST_PEER_ACK_DELAY_MS: "1000" };
  nodeB = startNode(bEnv);
  nodeA = startNode(aEnv);
  const baseA = `http://127.0.0.1:${aPort}`;
  const baseB = `http://127.0.0.1:${bPort}`;
  await waitFor(async () => (await request(baseA, "/v1/health")).nodeId === "node-a", "node A startup");
  await waitFor(async () => (await request(baseB, "/v1/health")).nodeId === "node-b", "node B startup");

  const sent = await request(baseA, "/v1/send", { method: "POST", body: JSON.stringify({ peerId: "node-b", envelope: event, clientId: "fixture", commandId: "forced-restart" }) });
  assert.equal(sent.delivery, "queued");
  const eventId = sent.eventId;
  await waitFor(async () => (await request(baseB, "/v1/inbox")).events.some((item) => item.eventId === eventId), "node B durable receipt");
  await waitFor(async () => (await request(baseA, "/v1/outbox")).items.some((item) => item.eventId === eventId && item.status === "sending"), "node A in-flight outbox");
  stopHard(nodeA);
  await exited(nodeA);

  nodeA = startNode(aEnv);
  await waitFor(async () => (await request(baseA, "/v1/health")).nodeId === "node-a", "node A restart");
  const recovered = await waitFor(async () => {
    const item = (await request(baseA, "/v1/outbox")).items.find((candidate) => candidate.eventId === eventId);
    return item?.status === "confirmed" ? item : null;
  }, "outbox confirmation after restart");
  assert.ok(recovered.attempts >= 2, `expected a retry after forced exit, got ${recovered.attempts} attempts`);

  const beforeRestart = await request(baseB, "/v1/sync?limit=1");
  assert.equal(beforeRestart.events.length, 1);
  assert.equal(beforeRestart.events[0].eventId, eventId);
  stopHard(nodeB);
  await exited(nodeB);
  nodeB = startNode(bEnv);
  await waitFor(async () => (await request(baseB, "/v1/health")).nodeId === "node-b", "node B restart");
  const read = await request(baseB, "/v1/receipts", { method: "POST", body: JSON.stringify({ eventId, deviceId: "device:fixture", state: "read" }) });
  assert.equal(read.item.eventId, eventId);
  const afterRestart = await request(baseB, `/v1/sync?cursor=${encodeURIComponent(beforeRestart.nextCursor)}`);
  assert.equal(afterRestart.events.length, 1);
  assert.equal(afterRestart.events[0].eventId, eventId);
  assert.equal(afterRestart.events[0].facts.devices[0].presentation, "read");
  const convergenceA = await request(baseA, "/v1/sync");
  const convergenceB = await request(baseB, "/v1/sync");
  assert.deepEqual(convergenceA.events.map((item) => item.eventId), convergenceB.events.map((item) => item.eventId));
  console.log("Node recovery smoke passed: forced exit -> outbox retry, durable cursor, and two-node convergence");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (nodeA?.debugOutput) console.error(nodeA.debugOutput());
  if (nodeB?.debugOutput) console.error(nodeB.debugOutput());
  process.exitCode = 1;
} finally {
  stopHard(nodeA);
  stopHard(nodeB);
  await Promise.all([nodeA && exited(nodeA), nodeB && exited(nodeB)]);
  rmSync(work, { recursive: true, force: true });
}
