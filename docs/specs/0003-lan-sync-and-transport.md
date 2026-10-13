# 0003 LAN synchronization and transport

English | [中文](0003-lan-sync-and-transport.zh.md)

Status: draft.

## Scope

This specification defines the Linko local node, peer discovery, delivery recovery, REST synchronization, WebSocket acceleration, and fallback behavior. It covers one-to-one delivery and the transport foundation for groups of up to 500 members.

## Local node

Each installation runs a local Linko node. The node owns the local SQLite event log, outbox, inbox, receipts, notification projections, and peer sessions. CLI, Web UI, and DeepSeek Harness integrations connect to the local node instead of opening a connection to every peer.

The node is a peer, not a mandatory central server. It can accept connections, initiate connections, cache encrypted objects, and serve scoped synchronization requests. A deployment MAY use one or more always-on peers as mailboxes, but no mailbox is the source of universal truth.

## Network profiles

The baseline profile uses ordinary IP connectivity, HTTP request/response, HTTP keep-alive, and WebSocket over TCP. It MUST work without special router or switch configuration.

The enhanced profile MAY use IPv6, HTTP/2, QUIC, WebTransport, or libp2p transports after capability negotiation. Enhanced transports are performance and reachability options; they MUST fall back to the baseline profile. Linko MUST NOT require a user to enable a switch feature, create a VLAN, or change router firmware to send a message.

Network equipment can improve the environment operationally. IPv6 and DNS-SD can reduce manual addressing; multicast snooping can reduce discovery noise; VLANs and access control lists can segment trust zones; QoS can prioritize interactive traffic. These are deployment controls, not Linko protocol requirements. A client must behave correctly when they are absent or misconfigured.

## Discovery and overlay

The first discovery attempt SHOULD use DNS-SD over mDNS for a local link. A node advertises a stable Peer ID, protocol versions, transport endpoints, and a short-lived capability summary. mDNS is not used to broadcast message payloads.

If mDNS is unavailable or the network crosses a routed boundary, the node can use manual pairing, a known rendezvous peer, peer exchange, or a bounded DHT. Discovery, task query expansion, and event anti-entropy are separate operations. A direct message uses a known endpoint whenever possible. Topic synchronization uses a selected mesh with deduplication, a fan-out budget, a byte budget, a deadline, and an upper hop limit.

## REST synchronization

REST is the recovery and source-of-truth interface. The minimum conceptual endpoints are:

```text
GET  /v1/node
GET  /v1/health
GET  /v1/sync?cursor=...&wait=30
POST /v1/envelopes
GET  /v1/envelopes/{id}
GET  /v1/objects/{hash}
POST /v1/receipts
```

`POST /v1/envelopes` MUST be idempotent by envelope ID or an explicit idempotency key. `/v1/sync` returns a bounded batch and a next cursor. A cursor gap, expired cursor, or incompatible protocol causes a snapshot-and-delta recovery. Content-addressed objects can be requested separately and verified against their hash.

## WebSocket acceleration

WebSocket is an optimization for live delivery and UI responsiveness. It is not the durable queue. A session begins with a protocol and capability handshake, includes a last-known cursor, and can send event hints, small events, receipts, and flow-control signals. A reconnecting client uses REST synchronization to repair any gap.

Implementations MUST use ping/pong or an equivalent liveness check, graceful close codes, maximum frame and queue sizes, bounded in-flight work, and exponential backoff with jitter. A node MUST not create a reconnect storm after a shared network failure.

## Delivery and anti-entropy

The sender appends to its outbox before attempting network delivery. The recipient persists the envelope before reporting `delivered`. Delivery is at least once; recipients deduplicate by envelope ID and content hash. A receipt is a separate event and cannot mutate the original envelope.

Nodes exchange compact digests and fetch missing event ranges. Per-author sequence numbers, causal metadata, and signed content hashes provide ordering and auditability without requiring a global total order. A group does not require every member to maintain a connection to every other member.

## LAN failure cases

The implementation must handle Wi-Fi client isolation, VLAN boundaries, changing IP addresses, duplicate mDNS records, sleeping devices, firewall rejection, half-open TCP sessions, stale peer advertisements, and temporary node loss. A peer identity is stable across address changes. Local caches and outboxes make temporary peer loss visible as delayed delivery instead of data loss.

## Acceptance evidence

- A two-node installation works with ordinary TCP and no managed-switch configuration.
- A WebSocket interruption is repaired by a cursor-based REST sync without duplicate inbox messages.
- mDNS failure falls back to pairing or a configured rendezvous peer.
- Discovery does not transmit message bodies.
- A test can measure bytes, duplicates, latency, queue depth, and stale state at 100, 1,000, 10,000, and 20,000 simulated peers.
