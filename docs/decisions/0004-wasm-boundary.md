# 0004 TypeScript reference and WASM boundary

Status: accepted for the design phase.

## Decision

TypeScript 7 is the first implementation language and behavioral reference. The repository uses pnpm 12 and requires Node.js `^24.22.3 || >=26.13.1`, following the Node.js requirement introduced in [DSH v0.2.3-alpha.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.3-alpha.2).

Rust/WebAssembly is reserved for deterministic work that benefits from a shared implementation across runtimes, including event validation, signature checks, digest comparison, routing policy, and redaction.

WebSocket lifecycle, filesystem access, DSH lifecycle, and platform integration remain host responsibilities. WASM is introduced only after TypeScript fixtures and an explicit boundary decision exist.

## Consequences

The project can begin without a native toolchain while preserving a path to a useful Rust component. Cross-runtime fixtures must prove equivalent behavior before the WASM implementation becomes authoritative.
