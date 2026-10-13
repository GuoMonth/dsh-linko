# Linko

English | [中文](README.zh.md)

Linko is an open-source, local-first collaboration mesh for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It helps agents find the right collaborator, exchange evidence-backed context, and continue a task under explicit human-controlled policies.

Linko is currently in the design phase. The repository is specification-driven: product boundaries, data contracts, network budgets, privacy rules, and architecture decisions are documented before the runtime is built.

## Why Linko

LAN messaging and approval panels are useful building blocks. Linko adds the part that becomes more valuable with use:

- Each person and agent can keep a subjective, signed ledger of capability claims and collaboration evidence.
- A routing query produces a personalized recommendation with an explanation of why a collaborator was selected.
- Context is shared by scope and purpose instead of being broadcast as a complete private history.
- A human can answer an inbound request, ask their agent to draft a reply, or delegate a bounded response policy.
- Local discovery, query expansion, and ledger synchronization use separate budgets so a large LAN does not become a broadcast storm.

## Project status

The first milestone is documentation and protocol design. No runnable plugin is promised yet.

- Product scope: [English](docs/specs/0001-product-scope.md) · [中文](docs/specs/0001-product-scope.zh.md)
- Architecture: [English](docs/architecture.md) · [中文](docs/architecture.zh.md)
- Roadmap: [English](ROADMAP.md) · [中文](ROADMAP.zh.md)
- Decisions: [English](docs/decisions/README.md) · [中文](docs/decisions/README.zh.md)

## Design direction

The logical model is a graph, the synchronization model is an append-only signed event log, and the first physical store is SQLite with JSONL export and replay. A user's global view is a versioned projection of many signed claims through that user's trust, privacy, and task context.

The network begins with a bounded local overlay. It uses direct requests and digest-first anti-entropy instead of full-payload flooding. Rust and WebAssembly are reserved for deterministic protocol validation, Merkle synchronization, routing policy, and context redaction when those boundaries are proven useful.

## DeepSeek Harness fit

Linko is intended to be a community plugin and companion protocol for the DeepSeek Harness ecosystem. It follows the Harness model that capabilities are composable plugins, while keeping the Linko protocol independently usable by other agents and clients.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the repository guidance in [AGENTS.md](AGENTS.md). Early contributions are most useful as design review, threat modeling, interoperability experiments, and small protocol fixtures.

## Topics

The repository is indexed with dsh, dsh-plugin, deepseek-harness, agent-collaboration, local-first, peer-to-peer, websocket, wasm, typescript, and knowledge-graph.

## License

[MIT](LICENSE)
