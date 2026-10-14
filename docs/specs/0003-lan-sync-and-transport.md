# 0003 LAN synchronization and transport

English | [中文](0003-lan-sync-and-transport.zh.md)

Status: draft; the 2026 transport direction is recorded in [ADR 0010](../decisions/0010-wss-live-session-and-recovery.md).

## Baseline

One local node owns one SQLite database. DSH, the human inbox, and CLI adapters use the authenticated local API. Peer recovery uses HTTPS over TCP; the approved WSS session is intended for online envelopes and receipts, but is not yet implemented. REST cursor sync and the SQLite/outbox remain canonical recovery. Long polling uses the same bounded sync API. The local UI does not discover or connect to every remote peer.

Working unicast IP reachability and permitted ports are prerequisites. No Linko-specific switch/router feature is required. Manual pairing repairs discovery failure, not firewalls, VLAN ACLs, or Wi-Fi client isolation. WebTransport and QUIC are deferred experiments until a measured bottleneck and bounded fallback test exist.

## Pairing and discovery

Start with an explicit endpoint and out-of-band key verification. Endpoint changes do not change peer identity. mDNS/DNS-SD is an optional local-link hint, equal to explicit pairing, not an assumption of the protocol. Advertise only minimal endpoint/version hints; discovery never grants trust or broadcasts messages or capability histories.

Configured rendezvous and bounded peer exchange can be added for routed segments. They cannot bypass blocked IP paths. No DHT, mandatory public bootstrap, or network-wide flooding belongs in the baseline. Discovery, task-query expansion, and state synchronization have separate budgets.

## Pull contract

Durable committed records are facts; REST is the recovery interface:

```text
GET  /v1/node
GET  /v1/sync?cursor=...&wait=...
POST /v1/envelopes
GET  /v1/objects/{hash}
POST /v1/receipts
```

These are conceptual endpoints, not a frozen wire format. The local admin profile uses loopback Host and Origin checks; the paired non-loopback profile authenticates the separate peer listener and scopes requests to configured peers. POST deduplicates by verified event identity. Sync returns a bounded batch and opaque next token tied to issuing peer, authorized scope, and log epoch. A cursor is not a global message order. Persist the batch and next checkpoint atomically.

The MVP wire shape returns each `events[]` item as the envelope fields plus `eventId`, `cursor`, and a sibling `facts` object. The facts object is a projection; it is not part of the immutable envelope. `POST /v1/receipts` accepts `{ eventId, deviceId?, state, actionId? }`, where `state` is `presented`, `read`, `acknowledged`, `approved`, or `rejected`. Approval and rejection are terminal decisions in this milestone; no receipt starts execution. A real node response must pass through the web parser in the cross-package contract fixture.

The paired delivery profile adds three small surfaces:

```text
GET  /v1/peers
POST /v1/send                 { peerId, envelope, clientId, commandId }
GET  /v1/outbox
POST /v1/peer/events          (HTTPS peer listener only)
```

`/v1/send` commits the local envelope and its outbox row together. A retry uses the same `clientId` and `commandId`; the receiver stores the same event identity at least once and returns a duplicate response when appropriate. The sender has a finite retry budget and exposes `abandoned` rather than retrying forever; a new explicit command can requeue the same event. The peer listener has no local-admin routes, requires the configured bearer secret, and checks the configured certificate pin on outbound connections. The local admin listener stays on loopback. A peer directory exposes labels only, never secrets.

Expired tokens or changed log epochs trigger an explicit bounded snapshot-plus-delta recovery. An incompatible protocol version produces a version error; a snapshot cannot fix protocol incompatibility. Missing dependencies remain bounded pending work. See [state and storage](0005-state-and-storage.md).

The initial handshake has a closed vocabulary: protocol/schema versions, peer identity proof, log epoch, endpoint hints, maximum frame/batch/object sizes, and optional group/encryption profile IDs. WSS live sessions must preserve these authorization and size boundaries. Unsupported required versions or encryption suites fail explicitly. WSS loss or unavailability falls back to REST cursor recovery; required encryption never falls back to plaintext.

## WSS live session

The approved WSS channel carries online envelopes and receipts after authenticated session setup. It does not own durable truth or advance a recovery cursor: SQLite, the outbox, and REST cursor sync remain canonical. Lost acknowledgements, duplicated live/recovered events, and reconnects use the same event identity and deduplication rules. The current node does not implement this session yet; do not describe this specification as shipped behavior.

Require ping/pong or equivalent liveness, idle timeout, frame and queue caps, bounded in-flight requests, graceful close, and exponential reconnect backoff with jitter. Reserve capacity for control traffic so object fetches cannot starve recovery.

## Delivery and availability

Persist an event and delivery job before sending. Commit verified receive/dedupe/inbox state before reporting delivery. Response loss causes retry of the same event. This is at-least-once transmission with idempotent local insertion, not exactly-once external effects.

A sender, recipient cache, or explicitly authorized mailbox must retain an online copy for retrieval. If all eligible holders are offline or have deleted content, show delayed/unavailable status; do not promise offline delivery from nothing. Encrypted mailboxes are a later milestone with quota, retention, metadata exposure, and deletion rules.

Simple cursor pull and explicit missing dependencies are sufficient initially. Per-actor ranges, digests, peer exchange, and selective replication need their own measured extension; Merkle synchronization is not assumed.

## Bounds and evidence

Before transport implementation, specify numeric connection, queue, batch, retry, pending-dependency, and object limits with overload errors. A hop limit alone is not storm control. Known-recipient delivery uses unicast; group fan-out uses a bounded connection pool.

The intended deployment envelope remains up to 20,000 participants, as requested. This is a design constraint, not supported capacity: no full mesh or network-wide payload broadcast. Release claims require incremental 100/1,000/10,000/20,000 simulated discovery tests plus representative physical LAN/Wi-Fi evidence. Group traffic is tested separately.

Acceptance traces cover ordinary TCP, disabled mDNS, IP change, sleeping devices, firewall rejection, half-open sessions, reconnect storms, response loss, old cursors, missing bodies, and restart recovery. A working two-node direct connection is the first gate.
