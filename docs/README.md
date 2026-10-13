# Linko documentation

English | [中文](README.zh.md)

The documentation is organized around decisions that can be reviewed before implementation.

## Start here

- [Product scope](specs/0001-product-scope.md): the problem, first users, invariants, and non-goals.
- [Message envelope](specs/0002-message-envelope.md): covers, body references, authorship, Agent controls, and reading states.
- [LAN sync and transport](specs/0003-lan-sync-and-transport.md): local nodes, REST recovery, WebSocket acceleration, discovery, and fallbacks.
- [Group chat and E2EE](specs/0004-group-chat-and-e2ee.md): the 500-member profile and the message-layer encryption boundary.
- [Architecture](architecture.md): the layers, data model, and runtime boundaries.
- [Roadmap](../ROADMAP.md): phase gates and acceptance evidence.
- [Decision records](decisions/README.md): durable choices and their consequences.
- [SEO and discoverability](seo.md): repository metadata and public terminology.

## Documentation rules

Every English document that describes product behavior has a paired Chinese document. Specifications state observable requirements. Decision records explain why a choice was made. The roadmap records what evidence is needed before the next phase begins.
