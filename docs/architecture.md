# Linko architecture

English | [中文](architecture.zh.md)

Linko is a decentralized local collaboration system built around a local node. A local node owns durable state and can act as both a client-facing service and a peer. No central service is required for normal LAN operation, and no node is assumed to be trusted merely because it is reachable.

The architecture uses familiar network layers for reliability. Linko adds its product behavior at the message, policy, and projection layers rather than replacing IP routing, switch forwarding, or decades of instant-messaging delivery practice.

## Runtime shape

```text
DSH plugin / CLI / Web UI
            │ localhost REST + WebSocket
            ▼
        Linko node
  SQLite event log and projections
  outbox / inbox / receipts / policies
            │ peer sessions
            ▼
     other Linko nodes on the LAN
  direct delivery, selected relays, sync
```

The local UI connects to one local node. The node manages peer discovery, authentication, synchronization, notifications, and storage. This keeps peer networking out of every UI and gives CLI, Web, and Harness clients the same recovery behavior.

## Layers and ownership

| Layer | Owns | Baseline | Optional enhancement |
| --- | --- | --- | --- |
| Product envelope | cover, body references, human/Agent authorship, actions, approvals | Linko envelope schema | richer declarative surfaces |
| Local state | identities, keys, events, inbox, outbox, receipts, projections | SQLite; JSONL export/replay | encrypted object store and replicas |
| Sync protocol | cursors, event ranges, digests, deduplication, anti-entropy | REST pull and idempotent writes | Merkle summaries and selective replicas |
| Peer session | pairing, authentication, liveness, flow control | TCP + HTTP/1.1 + WebSocket | QUIC, WebTransport, libp2p adapters |
| Discovery | local service discovery and peer endpoints | DNS-SD over mDNS or explicit pairing | rendezvous peer, bounded DHT, peer exchange |
| Delivery policy | retry, mailbox, fan-out, expiry, hop and byte budgets | local queues and selected peers | encrypted multi-replica mailboxes |
| Group layer | membership, receipts, 500-member cap, key events | bounded topic delivery | larger profile after new evidence |
| Harness adapter | DSH tools, sessions, approvals, background work | local plugin interface | adapters for other Agent hosts |
| Human surface | inbox, envelope cover, detail surface, audit and settings | TypeScript/HTML client | OpenUI/A2UI/MCP Apps adapters |

## Network device boundary

The baseline profile works with ordinary IP connectivity and does not require special router or switch configuration. Linko does not implement application-level Ethernet or IP routing.

Network features can raise an installation's ceiling, but they are capability inputs rather than prerequisites:

- IPv6 and DNS-SD can reduce manual address configuration.
- Multicast snooping can reduce discovery noise when the network supports it.
- VLANs, ACLs, and 802.1X can provide operator-managed segmentation.
- QoS can prioritize interactive traffic over bulk object transfer.
- HTTP/2, QUIC, or WebTransport can improve multiplexing and reconnect behavior.

The node probes and negotiates available capabilities, then falls back to TCP, REST, and WebSocket. A user should not have to change switch firmware or router settings to send a message. A VLAN or firewall boundary can prevent discovery; explicit pairing or a configured rendezvous peer handles that case.

At the expected 10,000–20,000 participant scale, one broadcast domain and a full mesh are inappropriate assumptions. mDNS is limited to a local link. Peer exchange, rendezvous, or a bounded DHT can connect segments without broadcasting message payloads to every participant.

## State and event model

The logical model is a property graph: people, Agents, projects, capabilities, claims, evidence, conversations, and policies are vertices and typed edges. The synchronization model is an append-only signed event log. SQLite is the first physical store because it provides transactions, indexes, local queries, and deterministic replay without a central database.

The core event fields are:

- stable event and actor identifiers;
- per-author sequence and causal references;
- envelope kind and immutable payload hash;
- author, composer, sender, delegator, and audience;
- visibility, expiry, revocation, and action policy;
- conversation or group identifier;
- delivery, receipt, and synchronization metadata.

There is no global reputation score or global message order. A recommendation is a user- and task-specific projection over signed claims and evidence. Concurrent events remain inspectable; projections can choose a view without deleting competing claims.

## Message and group behavior

Every message is a Linko envelope with a cover, optional inline body, body reference, optional human surface reference, and seal. The cover is sufficient for an inbox row and notification. Large bodies are fetched from a local cache or a scoped peer reference after the envelope is persisted.

Human, delegated Agent, autonomous Agent, and system messages are distinct at the protocol level. Agent envelopes carry intent, risk, expiry, authority, and fan-out policy. Text does not grant execution authority.

The initial group profile is capped at 500 members. It does not create 500 connections per member. A group uses an event stream, selected delivery paths, bounded fan-out, per-device read watermarks, and membership policy. Group message-layer encryption is a separate requirement from transport encryption; the initial design evaluates MLS or another established asynchronous group protocol and does not invent cryptography.

## Synchronization and delivery

REST is the source of truth for history, recovery, and convergence. WebSocket is an acceleration channel for live event hints, small events, receipts, and UI responsiveness. A client sends its last cursor when opening a session. A dropped or stale socket is repaired through `/v1/sync`, not by assuming that a push was received.

The sender persists to its outbox before sending. The recipient persists before reporting `delivered`. Delivery is at least once and receiver-side deduplication is required. Read and action states are separate events or projections; a notification is a local side effect.

Nodes exchange compact digests and fetch missing ranges. Discovery, task query expansion, and anti-entropy synchronization have independent budgets. A hop limit is one safety budget among fan-out, byte, time, queue, and deduplication limits.

## Security boundaries

LAN reachability is not trust. Devices are paired explicitly or verified through a controlled enrollment flow. Peer sessions use authenticated encryption. Message bodies intended for relay or mailbox storage are encrypted at the message layer. The local node validates signatures, scopes, expiry, capabilities, and size before writing an event or invoking a tool.

UI surfaces are rendered from an allowlisted component catalog. Remote HTML or JavaScript does not become executable authority. A UI action is untrusted input and is rechecked against the current message version, actor, capability, and expiry.

## WebAssembly boundary

TypeScript 7 is the behavioral reference. Rust/WebAssembly is reserved for deterministic, cross-runtime work that benefits from one implementation: event and signature validation, digest comparison, content hashing, bounded routing policy, graph layout, and context redaction. Filesystem access, sockets, WebSocket lifecycle, notifications, and DSH lifecycle remain host responsibilities.

WASM is introduced only after TypeScript fixtures establish behavior and a boundary decision records the measurable benefit. Optional QUIC or libp2p transports follow the same rule: they cannot change envelope or synchronization semantics.

## Reference patterns

Linko studies public protocol behavior and documentation without copying implementation code:

- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/) for cursor-based sync, receipts, and history recovery.
- [XMPP Stream Management](https://xmpp.org/extensions/attic/xep-0198-1.6.html), [delivery receipts](https://xmpp.org/extensions/xep-0184.html), and [displayed markers](https://xmpp.org/extensions/attic/xep-0333-1.0.0.html) for mature IM semantics.
- [DNS-SD](https://www.rfc-editor.org/info/rfc6763/) and [mDNS](https://www.rfc-editor.org/info/rfc6762/) for zero-configuration local discovery.
- [WebSocket RFC 6455](https://www.rfc-editor.org/info/rfc6455/) for connection, liveness, close, and reconnect behavior.
- [libp2p secure channels](https://libp2p.io/docs/secure-channels-overview/) and [PubSub](https://libp2p.io/docs/pubsub/) for optional peer transport patterns.
- [Messaging Layer Security RFC 9420](https://www.rfc-editor.org/info/rfc9420/) for the group encryption evaluation.

## Open questions before implementation

- Which pairing ceremony works across ordinary Wi-Fi, VLANs, and WSL2 without weakening identity verification?
- Which established message-layer encryption implementation has the best TypeScript and Rust integration for the first group profile?
- Which local mailbox replication policy gives useful offline delivery without turning a peer into an undisclosed central server?
- Which envelope size threshold minimizes LAN round trips while keeping notifications and inbox sync small?
- Which 10,000–20,000 participant simulation produces useful anti-entropy and discovery budgets?
