# Linko local node MVP

English | [中文](README.zh.md)

This package is the first runnable local-only node. It uses one TypeScript process and one SQLite database.

## Run

\`\`\`sh
pnpm node:start
pnpm node:smoke
pnpm contract:smoke
\`\`\`

The node listens on loopback by default at port \`8787\`. Set \`LINKO_PORT\`, \`LINKO_DB\`, and \`LINKO_NODE_ID\` to change the local process. The browser preview defaults to \`http://127.0.0.1:8477\`; use \`?api=http://127.0.0.1:8787\` when the node uses its default port.

## MVP contract

The MVP supports immutable local envelopes, canonical content-derived event IDs, duplicate delivery attempts, SQLite WAL transactions, cursor pull, per-device presentation/read/acknowledgement facts, and approval state transitions. The cross-package smoke test exercises the real node response through the real web parser.

REST cursor pull is the durable path. WebSocket wake-up hints, peer pairing, signatures, multi-node authorization, and E2EE are intentionally deferred. The node advertises this honestly in \`/v1/node\`; this package is a local state prototype, not a trusted network service.
