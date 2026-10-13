# Linko architecture

English | [中文](architecture.zh.md)

Linko separates the product into a local state layer, a deterministic protocol layer, a transport layer, and a DeepSeek Harness integration layer. Each layer has a smaller responsibility than the layer above it.

## Layers

| Layer | Responsibility | Initial technology |
| --- | --- | --- |
| Local state | Identities, claims, evidence, events, projections, and audit history | SQLite; JSONL export |
| Protocol core | Validation, signatures, causal metadata, redaction, budgets, and merge rules | TypeScript reference; Rust/WASM candidate |
| Transport | Pairing, WebSocket sessions, acknowledgements, retries, and backpressure | TypeScript and platform WebSocket |
| Discovery | Presence and scoped capability hints | LAN discovery; exact mechanism is a pending decision |
| Harness adapter | DSH tools, sessions, human gates, and background delivery | DeepSeek Harness plugin |
| Client surface | Inbox, recommendation explanation, approval, and settings | DSH client plugin; later standalone client |

The WebSocket transport is not the source of trust. A reachable LAN node is still untrusted until its identity is paired and its message is verified.

## Data model

The logical model is a property graph: people, agents, projects, capabilities, claims, evidence, and relationships are vertices and typed edges. The synchronization model is an append-only signed event log. SQLite is the first physical model because it supports transactions, indexes, local queries, and deterministic replay without requiring a server.

An assessment is not a universal score. A claim keeps its author, subject, predicate, value, context, confidence, evidence references, audience, lifetime, and revocation state. Derived routing scores are projections for one user and one task; they can be recomputed and must retain their explanation.

## Event and sync direction

Nodes exchange a compact digest before requesting event bodies. A digest can cover a topic, project, or time range. The first implementation will keep a per-author sequence and causal metadata; the exact Merkle layout and conflict rules are specified before code.

Discovery, query expansion, and anti-entropy are separate operations:

- Discovery announces presence and a small capability summary.
- Query expansion asks selected peers for candidate evidence.
- Anti-entropy repairs missing events by digest, never by repeatedly rebroadcasting the full ledger.

Every request carries a hop budget, fanout budget, byte budget, deadline, and deduplication identifier. A normal query expands only a few overlay hops. A deeper search is explicit and consumes a larger budget.

## Harness composition

The DSH integration will follow the Harness plugin model. Host code owns network and persistence services. Client code owns the inbox and human gate. The plugin must be unloadable and must not hide network side effects in unrelated tools.

Planned tools include:

- request a collaborator recommendation
- send a scoped task request
- inspect pending inbound requests
- draft or approve a reply
- inspect the evidence behind a recommendation

The names and input contracts remain specification work until the first plugin decision is accepted.

## WebAssembly boundary

Rust/WASM is a candidate for deterministic code shared by Node and the browser: event validation, signature checks, digest comparison, routing policy, and redaction. The TypeScript implementation remains the behavioral reference until cross-runtime fixtures exist. WebSocket lifecycle, filesystem access, and DSH lifecycle remain host responsibilities.

## Open questions

- Which LAN discovery mechanism works across ordinary Wi-Fi, VLANs, and WSL2?
- What is the minimum identity and pairing ceremony for a first contact?
- Which claim visibility modes are understandable to users?
- How should correlated or colluding endorsements affect a personalized route?
- Which event and Merkle layout remains efficient at 10,000 to 20,000 participants?
