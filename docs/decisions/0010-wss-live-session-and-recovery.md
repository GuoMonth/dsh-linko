# 0010 WSS live sessions and durable recovery

English | [中文](0010-wss-live-session-and-recovery.zh.md)

Status: accepted transport direction for 2026; WSS implementation and acceptance evidence remain pending.

## Decision

Use WebSocket over TLS (WSS) as the online live session between paired peers. It carries live envelopes and receipts through the same authorization, validation, deduplication, and storage rules as REST delivery. This supersedes the hint-only WebSocket role in [ADR 0005](0005-local-node-rest-sync-websocket.md) and [ADR 0006](0006-lan-discovery-and-transport-profile.md); their local-node, recovery, and trust boundaries still apply.

SQLite owns durable accepted events and local operational state. The transactional outbox owns pending delivery and retry across socket loss and process restart. REST cursor synchronization remains the canonical recovery contract for disconnects, gaps, and catch-up. A successful socket write, ping/pong, or connection handshake is not durable acceptance and cannot advance a recovery checkpoint. A delivery acknowledgement requires the receiving transaction to commit; clients persist recovered batches and checkpoints atomically.

WSS sessions must have authenticated peer scope, bounded frames and queues, backpressure, liveness checks, and reconnect backoff. Reconnect resumes from the last durable checkpoint through REST; uncertain deliveries retry the same event identity from the outbox. Live traffic and recovered traffic share deduplication, so a reconnect must not create another inbox item or repeat an approved action.

WebTransport and QUIC remain deferred experiments, with no release commitment. Reconsider them only after a measured bottleneck, a bounded experiment, and evidence that the same durable recovery and authenticated TCP fallback still work.

mDNS/DNS-SD is an optional discovery hint only. Advertise minimal endpoint and version information; an advertisement neither authenticates a peer nor grants membership or permission. Explicit pairing and out-of-band verification remain available when discovery is absent.

Linko adds no application-layer router, transit forwarding overlay, or payload flooding. Known recipients use authenticated direct unicast; group delivery uses bounded direct fan-out. Routers and switches provide ordinary IP reachability and deployment controls, not Linko routing logic. Discovery, query expansion, and synchronization retain separate budgets.

## Rationale

A live session supports prompt bidirectional exchange while keeping crash recovery in the existing durable state model. Keeping SQLite, the outbox, and REST authoritative avoids introducing a second queue or a second definition of delivered. The chosen TCP/TLS baseline lets the project test one live-session design before considering additional transports.

## Implementation boundary

The current node implements paired HTTPS delivery, certificate pinning, bearer authentication, a SQLite outbox, and REST recovery. It does not yet implement the WSS live session. This decision selects the next transport direction; it is not release evidence for WSS, discovery, signatures, E2EE, group delivery, or capacity.

The local browser, CLI, and DSH companion bridge continue to use the local API. A peer-session decision does not require those clients to own peer sockets or discovery.

## Consequences and acceptance

- Keep REST recovery usable when WSS is disconnected or unavailable; do not weaken authentication or fall back to plaintext.
- Demonstrate authenticated bidirectional WSS delivery and receipts, rejection of unauthorized peers, and bounded overload behavior.
- Exercise half-open sessions, lost acknowledgements, duplicate live/recovered events, reconnect storms, and process crashes before and after durable commit.
- Show that outbox retries and REST catch-up converge without duplicate inbox messages or repeated action effects.
- Verify operation with mDNS disabled and direct configured endpoints; no application-layer routing or payload broadcast may be needed.
- Record this evidence in [Phase 2 of the roadmap](../../ROADMAP.md) before describing WSS as implemented.
