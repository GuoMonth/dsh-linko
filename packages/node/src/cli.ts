import { createNodeServer } from "./server.js";

const port = Number(process.env.LINKO_PORT ?? process.argv[2] ?? 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("LINKO_PORT or the first argument must be a TCP port between 0 and 65535");
}
const server = createNodeServer();
server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`Linko node listening on http://127.0.0.1:${actualPort}`);
  console.log("REST cursor sync is canonical; optional WebSocket wake-up hints are deferred in this MVP.");
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

