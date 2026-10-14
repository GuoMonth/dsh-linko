# 0006 LAN discovery and transport profile

English | [中文](0006-lan-discovery-and-transport-profile.zh.md)

Status: accepted for the design phase; the transport role is superseded by [ADR 0010](0010-wss-live-session-and-recovery.md).

## Decision

The baseline remains ordinary unicast IP, HTTPS over TCP, and scoped cursor pull. [ADR 0010](0010-wss-live-session-and-recovery.md) selects WSS as the approved online live session; this record retains the discovery, trust, and deployment constraints. Explicit pairing and out-of-band key verification are first-class. DNS-SD over mDNS is an optional local-link hint; its absence is normal.

The only negotiated values in the first profile are protocol/schema versions, peer proof, log epoch, endpoint hints, size limits, and optional group/encryption profile IDs. Unsupported required values fail explicitly. QUIC, WebTransport, HTTP/2, libp2p, peer exchange, and relays remain deferred experiments until a measured bottleneck, bounded experiment, and durable-recovery fallback test exist.

Linko does not require or configure VLAN, ACL, 802.1X, multicast snooping, QoS, jumbo frames, or router firmware. They may be useful deployment controls, but an application cannot reliably probe or negotiate them. A hop limit is a budget, not storm control.

## Rationale

Decades of LAN IM and P2P systems converge on reachability, identity, bounded queues, idempotent retry, and pull-based recovery. Product code should use those contracts instead of turning switch features into protocol requirements. A baseline that works on an ordinary TCP path is easier to debug and easier to port.

## Consequences

- Tests cover ordinary TCP, missing mDNS, changing endpoints, sleeping nodes, segmented networks, and reconnect storms.
- Discovery does not grant trust and never carries message bodies.
- Any enhanced transport must preserve the same event and cursor semantics.
