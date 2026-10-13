# Linko roadmap

English | [中文](ROADMAP.zh.md)

This roadmap reduces architectural uncertainty before adding product code. A phase is complete only when its protocol fixtures, failure evidence, and decision record are written down. A faster transport does not compensate for an undefined delivery or encryption contract.

## Phase 0 — Architecture baseline

Status: in progress.

- Define the envelope, human/Agent authorship, delivery states, and local-node boundary.
- Define REST cursor synchronization, WebSocket acceleration, outbox/inbox, and receipts.
- Set the initial group profile at 500 members and separate transport encryption from message-layer E2EE.
- Define LAN discovery, baseline transport, capability negotiation, and network-device non-dependencies.
- Record the clean-room reference policy and the public prior-art references.

Exit evidence: paired bilingual specs and ADRs for envelope semantics, LAN transport, sync, group capacity, and encryption scope.

## Phase 1 — Single-node durable state

Planned.

- Implement SQLite tables for identities, devices, envelopes, bodies, events, outbox, inbox, receipts, and projections.
- Support append-only signed events, JSONL export, replay, expiry, revocation, and idempotent insertion.
- Implement local notification projections and separate delivered, presented, read, acknowledged, and acted states.
- Produce a local why-this-collaborator explanation from a task context.

Exit evidence: deterministic fixtures reconstruct the same projections from the same event set, including duplicate and out-of-order events.

## Phase 2 — Paired two-node transport

Planned.

- Add explicit device pairing, stable Peer IDs, capability negotiation, and authenticated sessions.
- Implement REST envelope writes, cursor-based sync, content-addressed body fetch, and idempotent receipts.
- Add WebSocket event hints, heartbeat, flow control, graceful close, reconnect backoff, and cursor recovery.
- Test changing IP addresses, sleeping nodes, firewall rejection, half-open sockets, and missing mDNS.

Exit evidence: two nodes complete human-to-Agent and Agent-to-Agent handoffs with no central service, and recover after forced connection loss without duplicate inbox entries.

## Phase 3 — Envelope UI and Agent policy

Planned.

- Render the envelope cover locally while body and surface references are unavailable.
- Add human, delegated Agent, autonomous Agent, and system authorship display.
- Add risk, intent, expiry, capability, approval, and fan-out policies for Agent messages.
- Add a local inbox, notification grouping, human approval gate, detail surface, and audit view.

Exit evidence: a user can inspect the sender, authority, context references, actions, and delivery state before approving an Agent action.

## Phase 4 — Group chat and message-layer encryption

Planned.

- Implement group membership, invitations, removals, device changes, per-device read watermarks, and bounded fan-out.
- Enforce a hard 500-member profile limit.
- Evaluate an established asynchronous group E2EE implementation, with MLS as the primary candidate.
- Implement key lifecycle, offline catch-up, relay storage of ciphertext, and fail-closed behavior when keys are unavailable.
- Load-test 2, 50, 200, and 500-member groups.

Exit evidence: capacity, p95 delivery latency, bytes per member, receipt volume, key rotation, removal, offline recovery, and relay failure reports; the product only claims E2EE after message-layer tests pass.

## Phase 5 — LAN discovery and bounded peer exchange

Planned.

- Add DNS-SD over mDNS for local-link discovery, explicit pairing fallback, and configured rendezvous peers.
- Add peer exchange or a bounded DHT for routed segments without payload broadcast.
- Add digest-first anti-entropy, selected relay/mailbox replication, deduplication, backpressure, and expiry.
- Measure discovery and synchronization at 100, 1,000, 10,000, and 20,000 simulated participants.

Exit evidence: a network budget report covers multicast volume, peer degree, duplicates, bytes, stale state, queue depth, p95 latency, and recovery time.

## Phase 6 — DeepSeek Harness plugin

Planned.

- Package Linko as a DSH plugin with host and client faces.
- Expose tools for asking, checking the inbox, inspecting recommendations, reading scoped detail, drafting replies, and approving actions.
- Keep network side effects, policy decisions, and persistence visible through normal Harness composition.
- Add plugin install, reload, background delivery, and failure-recovery scenarios.

Exit evidence: the DSH plugin uses the public Linko envelope and sync contracts without a DSH-only wire format.

## Phase 7 — Deterministic WASM and enhanced transports

Planned.

- Move validated deterministic work into a Rust crate where shared Node/browser behavior has a measured benefit.
- Fuzz event parsing, signature checks, digest comparison, redaction, graph layout, and routing budgets.
- Add optional QUIC, WebTransport, or libp2p adapters only when they improve a measured scenario and preserve baseline fallback.
- Compare TypeScript and WASM projections using cross-runtime fixtures.

Exit evidence: every enhanced feature has a capability matrix, benchmark, fallback test, and documented reason for its complexity.

## Phase 8 — Ecosystem and interoperability

Planned.

- Publish the protocol, TypeScript SDK, DSH plugin, and reference client as separate packages.
- Add adapters for other local Agents without making DSH the only client.
- Publish interoperability examples, threat-model updates, migrations, and a compatibility policy.

Exit evidence: a third-party client can discover, request, synchronize, and answer a scoped task using the public protocol.
