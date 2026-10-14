# Linko local node MVP

English | [中文](README.zh.md)

This package runs one durable Linko node with a SQLite database. The local HTTP API is loopback-only. Paired nodes use a separate HTTPS listener with a pinned certificate and a per-peer bearer secret; TLS protects transport but does not provide end-to-end encryption.

## Run one node

```sh
pnpm node:start
pnpm node:smoke
pnpm node:recovery-smoke
pnpm contract:smoke
```

The local API listens on `127.0.0.1:8787` by default. Set `LINKO_PORT`, `LINKO_DB`, `LINKO_NODE_ID`, and `LINKO_ALLOWED_ORIGINS` to change local settings.

## Local live hints

The local node exposes `ws://127.0.0.1:8787/v1/live` by default. A client must connect from an allowed Origin, send `{ "type": "hello", "protocolVersion": "v1" }`, and wait for `ready`. The node then sends small `hint` messages when local state may have changed. Hints contain no message body, do not own a queue or cursor, and can be lost or duplicated; clients recover through `GET /v1/sync`. Paired WSS delivery remains a later transport milestone.

## Run two paired nodes

Generate a certificate for each node (use a CA and DNS/IP names appropriate to a real deployment; this short command is for a local two-node check):

```sh
mkdir -p .linko
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -subj '/CN=127.0.0.1' -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout .linko/node-a.key -out .linko/node-a.crt
openssl x509 -in .linko/node-a.crt -noout -fingerprint -sha256
```

Create one owner-readable config (`chmod 600 .linko/peers.json`) for each node. `certSha256` is the certificate fingerprint with or without colons, and `bearerSecret` is a random value shared with the receiving node:

```json
{
  "peers": [
    {
      "peerId": "node-b",
      "label": "Node B",
      "endpoint": "https://127.0.0.1:8788",
      "certSha256": "AA:BB:…:FF",
      "bearerSecret": "replace-with-a-random-secret"
    }
  ]
}
```

Start each process with its own DB, node ID, TLS files, and peer config. The HTTPS listener is disabled unless both TLS paths are set:

```sh
LINKO_DB=.linko/a.sqlite LINKO_NODE_ID=node-a LINKO_PEERS_FILE=.linko/peers-a.json \
LINKO_TLS_KEY=.linko/node-a.key LINKO_TLS_CERT=.linko/node-a.crt \
LINKO_PORT=8787 LINKO_PEER_PORT=8788 pnpm node:start
```

`GET /v1/peers` returns only `peerId` and `label`. `POST /v1/send` accepts `{peerId,envelope,clientId,commandId}`. It writes the local copy and outbox transactionally, retries the same event ID up to eight times with bounded exponential backoff, and deduplicates a command after restart. An exhausted item is visible as `abandoned`; an explicit new command can requeue the same event. `GET /v1/outbox` exposes delivery status and attempt count. The receiver accepts only authenticated HTTPS peer ingress; its local admin API is never exposed on that listener.

## MVP contract

`GET /v1/sync` returns flattened UI envelopes. Its opaque cursor covers arrivals, receipt/action changes, and outbox changes, and is scoped to the SQLite log epoch. `POST /v1/receipts` accepts `presented`, `read`, `acknowledged`, `approved`, or `rejected`; approval checks the requested action and expiry, and approved/rejected decisions are terminal for this milestone. Immutable envelopes cannot claim `facts`; the node projects those facts from its own durable rows.

The approved [2026 transport direction](../../docs/decisions/0010-wss-live-session-and-recovery.md) selects WSS for online live sessions, with REST cursor sync and SQLite/outbox as canonical recovery. WSS live sessions, signatures, and message-layer E2EE remain outside this MVP. HTTPS pairing authenticates the configured peer channel and must not be replaced with plaintext or TOFU.

`pnpm node:recovery-smoke` runs two real node processes against temporary SQLite databases and a self-signed HTTPS peer. It durably receives an event, kills the sending node before the peer acknowledgement, restarts it, and checks that the outbox retries and the peer still has one event. It also restarts the receiving node, resumes a cursor after a read change, and checks that both nodes converge on the same event set. The fixture uses the unset-by-default `LINKO_TEST_PEER_ACK_DELAY_MS` process setting only to place the forced-exit boundary after durable peer receipt.
