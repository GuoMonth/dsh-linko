# Linko documentation

English | [中文](README.zh.md)

The documentation is organized around decisions that can be reviewed before implementation.

## Start here

- [Product scope](specs/0001-product-scope.md): the problem, first users, invariants, and non-goals.
- [Message envelope](specs/0002-message-envelope.md): covers, body references, authorship, Agent controls, and independent state facts.
- [LAN sync and transport](specs/0003-lan-sync-and-transport.md): local nodes, planned WSS live sessions, REST/SQLite recovery, discovery hints, and fallbacks.
- [Group chat and E2EE](specs/0004-group-chat-and-e2ee.md): the 500-principal profile and message-layer encryption boundary.
- [Data and state transitions](specs/0005-state-and-storage.md): durable concepts, merge rules, cursors, transactions, and crash traces.
- [Architecture](architecture.md): the small kernel, network baseline, data boundaries, and extension rule.
- [Review record](review.md): critical findings, cuts, and formal verification boundary.
- [Roadmap](../ROADMAP.md): phase gates and acceptance evidence.
- [2026 transport decision](decisions/0010-wss-live-session-and-recovery.md): WSS live sessions, canonical REST/outbox recovery, and deferred transports.
- [Decision records](decisions/README.md): durable choices and their consequences.
- [SEO and discoverability](seo.md): repository metadata and public terminology.

## Documentation rules

Every English document that describes product behavior has a paired Chinese document. Specifications state observable requirements. Decision records explain why a choice was made. The roadmap records what evidence is needed before the next phase begins.
