# Linko

English | [中文](README.zh.md)

Linko is open-source, local-first envelope messaging for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It helps agents find the right collaborator, exchange scoped context, and continue a task under explicit human-controlled policies.

Linko is an early runnable MVP. The repository remains specification-driven: product boundaries, state transitions, delivery recovery, privacy rules, and architecture decisions are written beside the runtime.

## Why Linko

LAN messaging and approval panels are useful building blocks. Linko adds the part that becomes more useful with a person's own evidence and context:

- Each person and Agent can keep a subjective set of capability claims; later releases may attach signatures without creating a global reputation score.
- A task query can produce a local recommendation with evidence and an explanation.
- Context is shared by scope and purpose instead of being broadcast as a complete private history.
- A person can answer an inbound request, ask their Agent to draft a reply, or delegate a bounded response policy.
- Every delivery is a small envelope with a human-readable cover, machine-readable semantics, and an optional local body or safe surface.
- The experimental first group profile is capped at 500 member principals, with group delivery and message-layer E2EE as separate milestones.

## Project status

The MVP runs a SQLite-backed node and a human-first envelope inbox. It supports an explicit two-node HTTPS pairing profile with a durable outbox, pinned certificates, bearer authentication, retry-safe command IDs, and REST recovery. The replaceable TypeScript DSH companion bridge now provides `ask`, `inbox`, `inspect`, `draft`, `approve`, and `reply` adapters over the local API. WSS live sessions, message signatures, and E2EE remain later milestones; this is not a 20,000-node capacity claim.

- Product scope: [English](docs/specs/0001-product-scope.md) · [中文](docs/specs/0001-product-scope.zh.md)
- Architecture: [English](docs/architecture.md) · [中文](docs/architecture.zh.md)
- State and storage: [English](docs/specs/0005-state-and-storage.md) · [中文](docs/specs/0005-state-and-storage.zh.md)
- Review record: [English](docs/review.md) · [中文](docs/review.zh.md)
- Roadmap: [English](ROADMAP.md) · [中文](ROADMAP.zh.md)
- Decisions: [English](docs/decisions/README.md) · [中文](docs/decisions/README.zh.md)
- Local node MVP: [English](packages/node/README.md) · [中文](packages/node/README.zh.md)
- DSH companion bridge: [English](packages/bridge/README.md) · [中文](packages/bridge/README.zh.md)
- Envelope inbox UI: [English](packages/web/DESIGN.md) · [中文](packages/web/DESIGN.zh.md)

## Design direction

The first physical store is one SQLite database behind one TypeScript node. Immutable event content is durable; delivery attempts, read state, approvals, and notifications are local operational state. REST cursor synchronization and the SQLite outbox remain the canonical recovery path. The approved [2026 transport decision](docs/decisions/0010-wss-live-session-and-recovery.md) selects WSS as the online live session; its implementation remains pending. A graph can be materialized later as a view over claims; a graph database is not required.

The network uses ordinary IP and authenticated TCP/TLS connections, with explicit pairing. mDNS/DNS-SD is an optional discovery hint only; it does not grant trust or carry message bodies. Linko adds no application-layer router or payload flooding, and requires no Linko-specific router or switch feature. WebTransport/QUIC remain deferred experiments alongside DHT, Merkle synchronization, full-mesh sockets, blockchain consensus, and Rust/WASM; each needs a measured reason and a fallback test.

## DeepSeek Harness fit

Linko is intended to be a community plugin and companion protocol for the DeepSeek Harness ecosystem. It follows the Harness model that capabilities are composable plugins, while keeping the Linko protocol independently usable by other agents and clients.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the repository guidance in [AGENTS.md](AGENTS.md). Early contributions are most useful as design review, threat modeling, interoperability experiments, and small protocol fixtures.

## Topics

The repository is indexed with dsh, dsh-plugin, deepseek-harness, agent-collaboration, local-first, lan-messaging, envelope-messaging, human-in-the-loop, sqlite, typescript, and pnpm.

## License

[MIT](LICENSE)
