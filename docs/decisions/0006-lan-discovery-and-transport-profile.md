# 0006 LAN discovery and transport profiles

Status: accepted for the design phase.

## Decision

Linko uses ordinary IP networking as its baseline. The baseline transport profile is HTTP request/response plus WebSocket over TCP. DNS-SD over mDNS is the preferred zero-configuration discovery mechanism on a local link, with explicit pairing and configured rendezvous peers as fallbacks.

IPv6, HTTP/2, QUIC, WebTransport, and libp2p transports are optional enhanced profiles. A node negotiates capabilities and falls back to the baseline profile when an enhanced profile is unavailable.

Linko does not require router, switch, VLAN, multicast-snooping, QoS, 802.1X, or firewall changes for ordinary operation. Network devices may improve reachability, segmentation, or prioritization, but they are deployment optimizations rather than protocol dependencies.

Application-level forwarding is bounded and selective. Direct messages use direct delivery when a recipient endpoint is known. Discovery and anti-entropy may use bounded peer exchange or pub/sub. Message payloads are never broadcast as a consequence of presence discovery.

## Rationale

LAN behavior varies across Wi-Fi isolation, VLANs, operating systems, VPNs, and managed networks. Requiring a new switch or router feature would make a local-first product fail at the first installation. Capability-based enhancement gives the project a path to better latency and scale without removing the fallback that makes the system deployable.

## Consequences

- Tests must cover missing mDNS, changing IP addresses, segmented networks, and ordinary TCP.
- Peer identity is stable independently of an endpoint address.
- Advanced transport adapters can be added without changing message semantics.
- A hop limit is a safety budget, not a replacement for deduplication, fan-out limits, byte limits, or backpressure.
