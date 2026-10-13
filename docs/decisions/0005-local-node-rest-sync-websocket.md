# 0005 Local node, REST synchronization, and WebSocket acceleration

Status: accepted for the design phase.

## Decision

Every Linko installation is a local node that owns its SQLite event log, outbox, inbox, receipts, projections, and peer sessions. CLI, Web UI, and DeepSeek Harness integrations use the local node API.

REST with cursor-based synchronization is the source of truth for recovery, history, and state convergence. WebSocket is an acceleration channel for event hints, small live events, receipts, and UI responsiveness. A WebSocket connection is never the only copy of a message and never replaces cursor-based pull.

Delivery is at least once with receiver-side deduplication. The sender persists before sending; the recipient persists before reporting `delivered`. Read and action state are separate events or projections.

## Rationale

This combines the operational resilience of HTTP synchronization with the low latency expected from chat. A browser, CLI, or peer can continue after a dropped socket, a sleeping device, or a process restart. It also keeps the durable protocol independent of a particular WebSocket library.

## Consequences

- A local daemon or equivalent long-lived process is part of the runtime model.
- Every peer session needs a cursor, protocol version, capability set, and bounded queue.
- Implementations must support idempotency, replay-safe events, backoff, and cursor recovery.
- A push-only implementation is not conforming.
