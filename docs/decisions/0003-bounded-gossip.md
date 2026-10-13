# 0003 Bounded dissemination

Status: accepted for the design phase.

## Decision

Discovery, task query expansion, and ledger anti-entropy are separate protocols. Payload forwarding is never an implicit consequence of presence discovery. Each request carries a hop budget, fanout, byte budget, deadline, topic scope, and event identifier. Nodes deduplicate recently seen identifiers and apply backpressure.

Normal queries expand through a small selected overlay. Deeper searches require an explicit user action. Anti-entropy exchanges digests and fetches missing ranges instead of repeatedly broadcasting full payloads.

## Consequences

The network can serve a large LAN without requiring a full mesh. Protocol tests must measure duplicates, bytes, latency, and stale state at several population sizes. A route hop limit alone is not a storm-control strategy.
