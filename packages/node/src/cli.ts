import { readFileSync } from "node:fs";
import { createNodeServer, createPeerServer } from "./server.js";
import { NodeStore, readPeerConfig } from "./store.js";

const localPort = Number(process.env.LINKO_PORT ?? process.argv[2] ?? 8787);
const peerPort = Number(process.env.LINKO_PEER_PORT ?? 8788);
// The local API is an admin surface. Keep it loopback-only; the peer listener
// below is the only surface that may bind to a LAN interface.
const localHost = "127.0.0.1";
const peerHost = process.env.LINKO_PEER_HOST ?? "0.0.0.0";
for (const [name, port] of [["LINKO_PORT", localPort], ["LINKO_PEER_PORT", peerPort]] as const) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`${name} must be a TCP port between 0 and 65535`);
}
const peers = process.env.LINKO_PEERS_FILE ? readPeerConfig(process.env.LINKO_PEERS_FILE) : [];
const store = new NodeStore({ peers });
const localServer = createNodeServer({ store });
const keyPath = process.env.LINKO_TLS_KEY;
const certPath = process.env.LINKO_TLS_CERT;
if ((keyPath && !certPath) || (!keyPath && certPath)) throw new Error("LINKO_TLS_KEY and LINKO_TLS_CERT must be provided together");
const peerServer = keyPath && certPath ? createPeerServer({ store, tls: { key: readFileSync(keyPath), cert: readFileSync(certPath) } }) : null;

let closed = false;
function shutdown(): void {
  if (closed) return;
  closed = true;
  let remaining = peerServer ? 2 : 1;
  const done = () => { remaining -= 1; if (remaining <= 0) { store.close(); process.exit(0); } };
  localServer.close(done);
  peerServer?.close(done);
}
localServer.listen(localPort, localHost, () => {
  const address = localServer.address();
  const actualPort = typeof address === "object" && address ? address.port : localPort;
  console.log(`Linko local API listening on http://${localHost}:${actualPort}`);
  if (peerServer) peerServer.listen(peerPort, peerHost, () => {
    const address = peerServer.address();
    const actualPort = typeof address === "object" && address ? address.port : peerPort;
    console.log(`Linko peer HTTPS listener on https://${peerHost}:${actualPort}`);
  });
  else console.log("Peer HTTPS listener disabled; set LINKO_TLS_KEY and LINKO_TLS_CERT to enable paired transport.");
  console.log("REST cursor sync is canonical; local WebSocket hints are advisory; peer delivery is authenticated HTTPS with durable retries.");
});
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
