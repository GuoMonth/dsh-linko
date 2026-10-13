# 0005 Local node, REST synchronization, and WebSocket hints

English | [中文](0005-local-node-rest-sync-websocket.zh.md)

Status: accepted for the design phase.

## Decision

Each installation runs one local Linko node with one SQLite database. CLI, Web UI, and DeepSeek Harness integrations use the local API.

Durable accepted domain events and declared local operational rows are the source of truth. REST is the canonical recovery and scoped synchronization interface. WebSocket is an optional wake-up hint channel; it can announce that state may have changed, but it cannot acknowledge a cursor or replace pull recovery.

Delivery is at least once with receiver-side verification and deduplication. The sender commits its event and delivery job before sending. The recipient commits the event, dedupe result, inbox projection, and checkpoint before reporting acceptance or delivery. Read, acknowledgement, approval, and action remain separate state dimensions.

## Rationale

A small local node keeps UI, CLI, and Agent integrations from each implementing peer discovery, retries, policy, and persistence. Pull recovery survives dropped sockets, sleeping devices, and process restarts. Treating WebSocket as an optimization avoids making liveness equal durability.

## Consequences

- One process owns the local transaction boundary; modules separate reducer, storage, and I/O.
- Every peer session has an authenticated scope, protocol version, log epoch, cursor, and bounded queue.
- A lost response causes a retry of the same event, not a new event.
- Any mailbox or relay is an availability helper with explicit retention and metadata exposure, never universal truth.
