# 0005 Local node, REST synchronization, and WebSocket hints

English | [中文](0005-local-node-rest-sync-websocket.zh.md)

Status: accepted for the design phase; its hint-only WebSocket role is superseded by [ADR 0010](0010-wss-live-session-and-recovery.md).

## Decision

Each installation runs one local Linko node with one SQLite database. CLI, Web UI, and DeepSeek Harness integrations use the local API.

Durable accepted domain events and declared local operational rows are the source of truth. REST is the canonical recovery and scoped synchronization interface. Historically, WebSocket was an optional wake-up hint channel; [ADR 0010](0010-wss-live-session-and-recovery.md) now selects authenticated WSS as the online live session. REST cursor synchronization, SQLite, and the outbox remain the canonical recovery path; this record does not claim WSS is implemented.

Delivery is at least once with receiver-side verification and deduplication. The sender commits its event and delivery job before sending. The recipient commits the event, dedupe result, inbox projection, and checkpoint before reporting acceptance or delivery. Read, acknowledgement, approval, and action remain separate state dimensions.

## Rationale

A small local node keeps UI, CLI, and Agent integrations from each implementing peer discovery, retries, policy, and persistence. Pull recovery survives dropped sockets, sleeping devices, and process restarts. Keeping durable recovery in REST, SQLite, and the outbox avoids making liveness equal durability; the 2026 decision applies this boundary while allowing WSS to carry live traffic.

## Consequences

- One process owns the local transaction boundary; modules separate reducer, storage, and I/O.
- Every peer session has an authenticated scope, protocol version, log epoch, cursor, and bounded queue.
- A lost response causes a retry of the same event, not a new event.
- Any mailbox or relay is an availability helper with explicit retention and metadata exposure, never universal truth.
