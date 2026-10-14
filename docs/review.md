# Architecture review and reflection

English | [中文](review.zh.md)

Status: accepted review outcome for the design phase; the 2026 transport direction is recorded in [ADR 0010](decisions/0010-wss-live-session-and-recovery.md).

This review was prompted by a simple rule: the smallest state model that survives crashes, retries, partitions, and human/Agent ambiguity is more valuable than a long list of future transports. A first review was performed against commit `80f2029`, then the findings were reconciled into the current specifications. Claude Code was used as a separate read-only reviewer; its report is recorded as review evidence, not as an implementation authority.

## Findings that changed the baseline

### 1. The truth boundary was overstated

REST is a recovery and projection interface. The approved WSS session is an online live path, but neither transport is the source of truth. Durable accepted domain events and explicitly local operational rows are the truth boundary; SQLite and the outbox retain the durable recovery state. A cursor is scoped to its issuing peer, stream, and log epoch.

### 2. Status was incorrectly treated as one lifecycle

Accepted, delivered, presented, read, acknowledged, approved, and acted describe different observations or attempts. They are independent dimensions. A read receipt cannot approve an action; an action can be automated before a human reads it; a WebSocket response cannot prove durable delivery.

### 3. Merge and conflict rules were missing

The project now defines a pure projection over a validated event set. Immutable facts union by event ID; monotonic markers use explicit maxima or coverage sets; authority-controlled membership and key versions require a parent chain. Equivocation or a broken authority chain is surfaced and blocks dependent projections. No first-arrival winner and no global score are allowed.

### 4. The 500-member cap needed an authority model

A local check cannot enforce a hard cap during a partition. The first group profile therefore proposes one designated membership signer per group, with a signed version and parent hash. That is a local coordination point, not a global server. If it is unavailable, existing members can communicate while membership changes wait. Multi-admin consensus, election, and failover are later decisions.

### 5. The network baseline was simplified

Ordinary IP and HTTPS over TCP remain the recovery baseline for the first two nodes. The approved WSS live session is a planned online path; REST cursor sync and the SQLite/outbox remain canonical recovery. mDNS is an optional hint. Router and switch features are deployment controls, never protocol requirements. DHT, Merkle synchronization, full-mesh sockets, and payload flooding are removed from the baseline.

### 6. Capacity and security claims were separated

A 500-member profile is a product test boundary, not a performance or security proof. A 10,000–20,000 participant LAN remains a future deployment envelope to measure, not a supported capacity claim. E2EE is a separate release: transport encryption, MLS evaluation, epoch recovery, removal, and stale-sender behavior must be tested before the claim appears in product copy.

## Cuts and parking lot

The following do not enter the baseline without a measured bottleneck and a new decision record:

- router/switch programming, VLAN/QoS/ACL negotiation, or multicast tuning;
- DHT, Merkle trees, global consensus, blockchain state, or a global reputation number;
- graph database or graph layout in the protocol core;
- microservices and separate local daemons for each feature;
- QUIC, WebTransport, libp2p, and relay/mailbox networks beyond one configured peer;
- Rust/WASM as a scheduled port or socket owner;
- Lean as a runtime dependency or a project-wide proof obligation;
- >500-member groups and >1,000-peer operational claims.

The graph remains a useful view of signed claims. Blockchain-style ideas remain useful as inspiration for append-only provenance and conflict evidence; consensus would add failure modes and latency without solving the local product's first problem.

## Verification decision

Use typed commands/events, SQL constraints, crash traces, and model/property tests as the implementation foundation. A small TLA+/TLC model is appropriate for cursor races, delivery retry, and serialized membership. A timeboxed Lean 4 spike may challenge the merge algebra, delivery-state independence, or the 500-cap counterexample, but it stays outside the build and cannot gate a release. If it produces no useful counterexample or proof target, delete it and record that result.

## Review gates

Before code is called production-ready, a reader must be able to answer:

1. What immutable record is authoritative?
2. Which state is local and which state is shared?
3. What exactly does a cursor acknowledge, and what happens after log rebuild?
4. Which actor can commit a group membership change?
5. Which failures cause retry, uncertainty, rejection, or visible conflict?
6. What evidence supports a delivery, capacity, or E2EE claim?

If a new feature cannot answer these questions with a small fixture and a bounded budget, it does not belong in the next phase.

## Round 2 — vertical-slice review

The first runnable packages exposed a useful failure: package-local green tests did not prove that the node and UI spoke the same contract. A hostile read-only review with empirical HTTP probes found the sync envelope shape, receipt shape, and browser CORS boundary broken, plus client-controlled event IDs, missing server-side expiry, an over-permissive action rank, fabricated presentation facts, and a cursor epoch bypass.

The first vertical slice was corrected before publication: the node now derives and verifies event IDs, keeps command/attempt metadata out of canonical bytes, maps its sync response to the UI envelope contract, accepts the UI receipt schema, uses an explicit loopback Host/Origin allowlist, records device facts without inferring presentation from read, enforces the action transition table and expiry, and rejects malformed/ahead cursors. The current slice also has a separate authenticated HTTPS peer listener, certificate pinning, bearer secrets, a transactional outbox, and a change cursor that includes receipt/action/outbox updates. `pnpm contract:smoke` crosses the real node response through the real web parser; node smoke covers restart-safe store logic and hostile request probes; and `pnpm node:recovery-smoke` runs a committed two-node HTTPS kill/restart trace in CI.

The critical limits remain deliberate. The local admin API is loopback-only, and the CLI must never bind it to a LAN interface. The peer certificate pin is the trust decision for the self-signed local profile; the request body is held until that pin passes. HTTPS is transport protection, not message-layer E2EE. WSS live sessions, signed authorship claims, group membership, execution effects, a broader failure matrix, and 20,000-participant capacity claims remain outside this MVP; the current node does not claim WSS support.

## Round 3 — adversarial contract review

A read-only Claude review then exercised the browser-to-node seam as a hostile consumer. It found a real blocker: the UI submitted the display-level `primary` action while composed envelopes advertised `approve` and `reject`, so every approval returned `ACTION_NOT_REQUESTED`. It also found cursor-reset state leaking old projections, an endpoint-path ambiguity, and UI copy that overstated provenance or preview status.

The MVP now uses the same action identifiers end to end, infers an omitted action only when the envelope offers exactly one action, clears the projection and decision ledger on a cursor reset, rejects peer endpoints with a path or query, labels peer origin as unverified authorship, and distinguishes preview, offline cache, and live node state. The cross-package smoke test exercises an envelope with both `approve` and `reject` and submits the real `approve` action. Bearer comparison is timing-safe. The review's remaining observations are deliberately parked: WSS implementation and evidence, cryptographic author signatures, retention/compaction, multi-action wire projection, and broader network failure coverage.
