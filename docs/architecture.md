# Linko architecture

English | [中文](architecture.zh.md)

Status: design baseline, revised after the simplicity review. A local single-node MVP exists; peer capacity and cryptographic claims remain implementation gates.

## Small kernel

```text
DSH / CLI / human inbox
          │ authenticated local API
          ▼
one TypeScript node + one local SQLite database
          │ HTTPS REST recovery + approved WSS live session (not yet implemented)
          ▼
another authenticated node
```

Three responsibilities are enough: **contracts and pure state transitions**, **transactional storage**, and **I/O adapters**. They are modules in one process, not microservices. The core decides from explicit inputs; it does not open sockets, read clocks, call models, or send notifications. The host validates input, runs a local transaction, then performs queued effects.

Committed domain records are the source of durable facts. SQLite and the transactional outbox retain durable state and pending delivery; REST cursor synchronization is the canonical recovery interface. The approved WSS live session will carry online envelopes and receipts under the same semantics, but is not yet implemented. No transport defines truth. A peer cursor belongs to its issuing node and authorized scope; it is not a global conversation sequence.

See [data and state transitions](specs/0005-state-and-storage.md) for keys, ownership, transaction boundaries, and failure behavior.

## Separate three graphs

- **Connectivity**: which devices can communicate. Use ordinary IP and direct authenticated connections.
- **Conversation membership**: who may receive which messages. Membership and encryption rules govern this.
- **Cognition**: who thinks a person or Agent can help, based on which evidence. Compute a local, subjective graph projection over scoped claims.

An endorsement never creates network reachability or grants authorization. Finding a collaborator first queries local indexes; bounded remote expansion comes later. No DHT, consensus blockchain, global score, global event order, or graph database is needed for the first working pair.

## Durable data, local operations, derived views

Immutable signed domain events record messages, membership changes, and shared claims. SQLite rows also hold local delivery jobs, cursor checkpoints, read state, and action attempts. Those operational rows are mutable and private; they are not all signed, broadcast, or put into an eternal ledger.

Indexes and views build the inbox, unread count, audit display, and collaborator recommendations. JSONL is a versioned export, not a second database or transaction log. Retention, deletion, schema migration, and minimal deduplication records need explicit policy; an append-only history does not mean keeping private payloads forever.

Identity has separate principal, device, and Agent/delegation fields. Agent-composed text approved by a person remains Agent-composed. A signature verifies a key and an asserted author; it cannot prove a human physically typed text.

## Networking: one baseline

Use authenticated HTTPS over TCP for peer recovery and the approved WSS live session for online envelopes and receipts. Both use the same authorization, validation, deduplication, and storage semantics; REST cursor sync remains canonical when WSS is unavailable. The current node implements HTTPS delivery and REST recovery, not WSS. Local browser UI talks only to its local node; it does not manage LAN certificates or peer discovery. The loopback MVP applies an explicit Origin allowlist and is not a trusted network service; peer authorization is mandatory before binding beyond loopback.

Pair an endpoint and verify its key out of band. mDNS/DNS-SD is an optional discovery hint only; advertisements contain minimal endpoint/version information, not capability histories, trust, membership, or message bodies. No normal operation depends on public bootstrap infrastructure. Multi-subnet discovery is a later deployment option.

Routers and switches need no Linko-specific features. Working IP reachability and permitted ports are prerequisites. Manual addressing solves discovery failure, not blocked traffic. VLAN ACLs, Wi-Fi client isolation, and firewalls can require operator configuration; a rendezvous node cannot bypass them.

Do not probe or configure QoS, SDN, VLANs, jumbo frames, TSN, or hardware multicast in the application. In particular, multicast snooping is not a general cure for mDNS: link-local multicast has special forwarding rules. IPv6 is address-family support; QUIC and HTTP/2 are host protocols, not new switch features. Consider additional transports only after an observed bottleneck. [DNS-SD](https://www.rfc-editor.org/rfc/rfc6763.html), [mDNS](https://www.rfc-editor.org/rfc/rfc6762.html), [IGMP snooping guidance](https://www.rfc-editor.org/rfc/rfc4541.html).

## Messages, groups, and availability

An [envelope](specs/0002-message-envelope.md) has a short cover and inline content or an immutable object reference. Delivered cover, cached body, human read state, and approved action are independent facts. A link alone cannot guarantee offline content: the recipient must obtain a verified local copy.

The first group profile targets at most **500 member principals**. Initial implementation uses one active device per principal; multiple devices need separate limits and evidence. The proposed simplest group control model is one designated membership signer per group, while members exchange messages directly. This tradeoff and the alternative of replicated authority remain a decision gate in [the group spec](specs/0004-group-chat-and-e2ee.md).

Start by measuring bounded direct fan-out through a connection pool, not full-mesh persistent sockets. Up to 499 recipients still means 499 deliveries per post. A count limit alone is not a capacity test. Groups, encrypted offline mailboxes, and 20,000-person discovery are separate milestones.

Without an authorized online copy there is no delivery. Without retained history there is no complete catch-up. There is no system-wide server, mandatory relay, public DHT, or automatic leader election in the initial design.

## Encryption and UI boundaries

LAN reachability does not imply trust. TLS authenticates peer sessions; message-layer E2EE protects content through non-recipient storage. Pairwise and group key lifecycle must be designed before sending real sensitive content. MLS is a candidate for group encryption, not a selected dependency or delivery system. Never silently fall back to plaintext.

Encrypt meaningful covers, bodies, and surface data for their intended audience; relays need only minimal routing metadata. Cached plaintext cannot be recalled. A membership removal protects messages encrypted under the updated keys after senders adopt the change; it cannot retroactively secure stale offline senders.

Human cards render known components. No arbitrary peer HTML/JavaScript execution. Agent input, UI actions, and remote risk labels cannot grant authority. The recipient checks delegation, current policy, payload digest, membership version, expiry, and action ID.

## Verification and extension rule

Start with explicit transition tables, typed commands/events, SQL constraints, and crash/reorder/duplicate traces. Use property-based tests against an independent model when code exists. Small TLA+/TLC models will check delivery/cursor races and membership serialization before those features ship. Lean 4 is reserved for a specific unbounded proof obligation; it is not a runtime dependency or a substitute for testing storage and networking. See [ADR 0008](decisions/0008-minimal-kernel-and-verification.md).

Rust/WASM remains a planned experiment for a measured deterministic workload, not socket ownership or custom cryptography. WebTransport and QUIC are deferred experiments. Linko adds no application-layer router or payload flooding. Merkle trees, gossip, richer UI adapters, and distributed recommendation algorithms need a demonstrated bottleneck, one bounded scope, and an acceptance test before they enter the baseline.

Reference assessment and review dispositions are in [the review record](review.md).
