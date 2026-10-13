# 0004 TypeScript reference and WASM boundary

Status: accepted for the design phase.

## Decision

TypeScript 7 is the first implementation language and behavioral reference. pnpm 12 and Node 24 or newer are the repository toolchain target. Rust/WebAssembly is reserved for deterministic, cross-runtime work that benefits from a shared implementation: event validation, signature checks, digest comparison, routing policy, and redaction.

WebSocket lifecycle, filesystem access, DSH lifecycle, and platform integration remain host responsibilities. WASM is introduced only after TypeScript fixtures and an explicit boundary decision exist.

## Consequences

The project can begin without a native toolchain while preserving a path to a useful Rust component. Cross-runtime fixtures must prove equivalent behavior before the WASM implementation becomes authoritative.
