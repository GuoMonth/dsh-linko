# 0008 Minimal kernel and verification boundary

English | [中文](0008-minimal-kernel-and-verification.zh.md)

Status: accepted for the design phase.

## Decision

The first runtime will be one TypeScript node with one SQLite database. Its core is a pure command/event reducer plus explicit transactional adapters. Durable domain events, local operational rows, and rebuildable projections are separate categories.

The initial verification stack is:

1. typed transition tables and SQL constraints;
2. language-neutral fixtures with explicit policy and clock inputs;
3. property/model-based tests and crash/reorder traces;
4. a small TLA+/TLC model for concurrency and liveness questions.

Lean 4 is allowed only as a timeboxed, out-of-band falsification spike for a concrete theorem or counterexample. It is not a runtime dependency, a required CI tool, or a phase gate. Rust/WASM is likewise conditional on a measured deterministic workload and cross-runtime fixtures.

## Rationale

The hard failures here are state and recovery failures, not a lack of transport novelty. A pure reducer makes replay and contradiction visible; SQLite gives a mature transaction boundary; fixtures make the boundary testable. TLA+ is better suited to exploring interleavings, while Lean is useful when a specific algebraic proof target survives simplification.

A formal model can prove the model's properties and falsify an assumption. It cannot prove that an unimplemented network, storage configuration, or cryptographic library has those properties.

## Consequences

- There is no microservice split, graph database, DHT, blockchain consensus, or global event order in the baseline.
- Merge rules and conflict behavior are documented before implementation.
- A crash test may fail even when a unit test passes; both are required for durable claims.
- The protocol can later add a WASM or formal artifact without changing the message contract, but no future toolchain is promised.
