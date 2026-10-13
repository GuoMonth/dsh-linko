# Linko repository guidance

Linko is a documentation-first, open-source collaboration mesh for DeepSeek Harness. The current repository defines the product and protocol before it implements a runtime.

## Working rules

- Read the applicable specification and decision record before changing an interface or data model.
- Keep the English and Chinese versions of user-facing Markdown paired. English is the canonical editing language; update the Chinese counterpart in the same change.
- Treat the public DeepSeek Harness repository as an architectural reference. Absorb its plugin-oriented composition and documentation habits without copying its source code.
- Treat Rellopn/dsh-p2p-lan as a research reference only. The clean-room reference is commit 62e47e45ab7e2729c23d38f30d26e9ab6af0768f; do not copy its source, wire format, tests, names, or implementation structure.
- The target toolchain is TypeScript 7, pnpm 12, Node 24 or newer, and Rust compiled to WebAssembly where the shared deterministic core benefits from it.
- Keep the local-first privacy model explicit. LAN reachability is not trust. Signed events, scoped visibility, expiry, revocation, and human approval are part of the design.
- Do not introduce a global reputation number. Claims must retain their author, evidence, context, confidence, lifetime, and audience.
- Do not add network flooding by default. Discovery, query expansion, and anti-entropy synchronization are separate mechanisms with explicit budgets.

## Documentation conventions

- Use direct, concrete prose and state ownership, timing, failure, and privacy behavior.
- Put durable product or protocol choices in docs/decisions.
- Put externally observable requirements in docs/specs.
- Update ROADMAP.md when a decision changes the phase gates or acceptance evidence.
