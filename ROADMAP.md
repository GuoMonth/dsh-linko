# Linko roadmap

English | [中文](ROADMAP.zh.md)

This roadmap reduces uncertainty before adding breadth. Every phase needs a fixture, a failure trace, and a review record. A new transport cannot compensate for an undefined state transition.

## Phase 0 — Cut and pin the contract

Status: baseline complete; changes require review.

- Define the envelope, authorship, independent delivery/read/action facts, and local-node boundary.
- Define the four durable concepts, local operational rows, merge/conflict rules, cursor scope, and crash boundaries.
- Define ordinary TCP/HTTPS pull, optional WSS hints, explicit pairing, and the fact that routers and switches are deployment controls.
- Define the 500-principal group profile, its membership-authority proposal, and the separate E2EE gate.
- Keep bilingual entry docs and decisions; make the docs check meaningful enough to catch missing or empty counterparts.

Exit evidence: a reader can name the authoritative event record, the projection function, the cursor scope, and the failure response for a duplicate, conflict, crash, and stale key.

## Phase 1 — Single-node MVP

Status: MVP complete; integration hardening continues.

- Implement one TypeScript node and one SQLite database.
- Implement immutable message events, command/delivery idempotency, local inbox projections, read markers, and approval/action attempts.
- Expose the small local API: health, node info, create/send envelope, scoped sync, peer directory, outbox, and receipt/action commands.
- Provide a human envelope-cover preview, compose/reply flow, and an offline fixture.
- Exercise duplicate delivery, cursor pull, approval expiry, hostile local requests, and the node-to-UI contract.

Exit evidence: `pnpm contract:smoke`, `pnpm smoke`, and `pnpm web:smoke` pass; the real node response passes through the UI parser and an approval does not duplicate the event. Process recovery is tracked and evidenced in Phase 2.

## Phase 2 — Paired two-node transport

Status: paired HTTPS and process-recovery baseline implemented; the adversarial network matrix remains open.

- Add explicit pairing and authenticated peer sessions.
- Make REST pull the recovery contract; add WSS only as a wake-up hint.
- Add bounded queues, retries, backoff, log epochs, and reset recovery.
- Test ordinary TCP, IP changes, sleeping nodes, firewalls, half-open sockets, and missing mDNS.

Current evidence: a real self-signed HTTPS push reaches the second node with one inbox item and a confirmed outbox. `pnpm node:recovery-smoke` now commits a forced-loss/restart trace: the sender's outbox is retried after a kill, the receiver resumes a cursor after restart, and both nodes converge on one event. The fixture is part of CI.

## Phase 3 — Envelope UI and Agent policy

Status: human-first envelope UI implemented; policy breadth remains planned.

- Render the cover before the body and keep untrusted surfaces inert.
- Show human, delegated Agent, autonomous Agent, and system authorship.
- Add risk, intent, expiry, capability, approval, fan-out, and byte policies.
- Use one obvious next action, immediate feedback, reversible choices, and a compact audit trail.

Current evidence: a person can inspect sender, authority, context, audience, and action before approving; decisions wait for node confirmation and no fake undo is offered. A durable local-dismissal policy remains open.

## Phase 4a — Groups over the event log

Planned.

- Implement the group membership state machine and one designated membership signer per group.
- Enforce the 500 active-principal profile at signed version commits; initial profile permits one active device per principal.
- Use bounded direct fan-out and unicast/bounded read receipts.
- Measure 2, 50, 200, and 500 principals at the actual device count.

Exit evidence: cap-boundary concurrency, signer loss, conflict quarantine, reconnect, receipt amplification, and queue limits are reported.

## Phase 4b — Message-layer E2EE

Planned.

- Evaluate an established asynchronous group protocol, with MLS as a candidate.
- Define epoch commits, offline catch-up, stale-sender behavior, removal, rejoin, backup, and user-visible key recovery before integration.
- Keep transport encryption and message-layer E2EE language separate.

Exit evidence: group content is not claimed as E2EE until key lifecycle, removal, offline recovery, and relay ciphertext tests pass.

## Phase 5 — Discovery and bounded exchange

Planned later.

- Add optional mDNS/DNS-SD hints, configured rendezvous, and bounded peer exchange.
- Keep discovery, query expansion, and anti-entropy budgets separate.
- Treat the 10,000–20,000 LAN participant envelope as a measurement target, not a supported capacity claim.

Exit evidence: a network budget report covers peer degree, multicast, bytes, duplicates, stale state, queue depth, and recovery on representative LAN/Wi-Fi networks.

## Phase 6 — DeepSeek Harness plugin

Status: replaceable local companion bridge contract complete; host-specific Harness integration remains out of scope.

- Package a dependency-free TypeScript companion bridge with explicit host and local-client faces; it does not copy or depend on DeepSeek Harness source.
- Expose `ask`, `inbox`, `inspect`, `draft`, `approve`, and `reply` through the existing loopback REST contract, plus a JSON CLI adapter.
- Keep network side effects and policy decisions visible through host composition; approval records a receipt and does not execute work.
- Keep non-loopback APIs, peer transport, discovery, signatures, E2EE, LLM prompting, and host scheduling outside this bridge.

Exit evidence: `pnpm bridge:contract:smoke` runs an Agent request through Linko, queries the inbox, inspects it, creates a reply draft, records approval, commits a reply, and checks the CLI adapter. The bridge can be replaced by another client without changing the Linko wire contract.

## Parking lot

No phase or release date is committed for DHT, Merkle synchronization, blockchain consensus, a graph database, QUIC/WebTransport/libp2p, >500-member groups, >1,000-peer operations, or Rust/WASM. Each needs a measured bottleneck, bounded scope, fallback behavior, and a fresh review.
