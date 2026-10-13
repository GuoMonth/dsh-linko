# Linko roadmap

English | [中文](ROADMAP.zh.md)

This roadmap records the order in which the project will reduce uncertainty. A phase is complete only when its acceptance evidence is written down; an implementation milestone does not replace a protocol decision.

## Phase 0 — Documentation and scope

Status: in progress.

- Define the product boundary, vocabulary, user journeys, and non-goals.
- Record the clean-room reference policy for Rellopn/dsh-p2p-lan.
- Decide the local-first ledger model, privacy scopes, expiry, revocation, and conflict handling.
- Define the network budgets that prevent discovery, query, and synchronization storms.
- Publish bilingual documentation and repository contribution rules.

Exit evidence: reviewed specifications and decision records with explicit unresolved questions.

## Phase 1 — Single-node ledger

Planned.

- Implement the SQLite schema for identities, claims, evidence, events, and projections.
- Support append-only signed events, JSONL export, replay, revocation, and expiry.
- Produce a local why-this-collaborator explanation from a task context.

Exit evidence: deterministic fixtures that reconstruct the same projection from the same event set.

## Phase 2 — Direct LAN collaboration

Planned.

- Add explicit device pairing and node identity.
- Add direct WebSocket request, reply, acknowledgement, and human-gate flows.
- Synchronize small, scoped event ranges between two nodes.

Exit evidence: a two-node scenario completes a human-to-agent and agent-to-agent handoff without a central service.

## Phase 3 — Bounded knowledge exchange

Planned.

- Add digest-first anti-entropy with Merkle summaries.
- Add topic and project scopes, relay selection, deduplication, backpressure, and expiry.
- Verify query budgets under simulated 100, 1,000, and 10,000-node overlays.

Exit evidence: measured message, byte, latency, and duplicate-event budgets for each scenario.

## Phase 4 — DeepSeek Harness plugin

Planned.

- Package Linko as a DSH plugin with host and client faces.
- Expose tools for asking, checking the inbox, inspecting recommendations, and approving replies.
- Keep policy and protocol state inspectable through normal Harness composition.

Exit evidence: installation, reload, approval, background reply, and failure-recovery scenarios.

## Phase 5 — Rust/WebAssembly core

Planned.

- Move deterministic validation, Merkle diffing, routing policy, and redaction into a Rust crate.
- Generate the Node and browser bindings only after the TypeScript reference behavior is stable.
- Fuzz the wire parser and compare TypeScript and WASM projections.

Exit evidence: cross-runtime fixtures and a documented reason for each WASM boundary.

## Phase 6 — Ecosystem and interoperability

Planned.

- Publish the protocol, TypeScript SDK, DSH plugin, and reference dashboard as separate packages.
- Add adapters for other local agents without making DSH the only client.
- Publish interoperability examples, threat-model updates, and migration notes.

Exit evidence: a third-party client can discover, request, and answer a scoped task using the public protocol.
