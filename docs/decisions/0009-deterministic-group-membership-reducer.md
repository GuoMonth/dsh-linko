# 0009 Deterministic group membership reducer

English | [中文](0009-deterministic-group-membership-reducer.zh.md)

Status: accepted for the experimental membership kernel; the initial 500-principal profile gate remains open.

## Decision

Implement membership as a pure TypeScript state machine in `packages/group`. The reducer accepts signed-version-shaped commit inputs and returns a new serializable state plus an explicit result. It has no dependency on crypto libraries, SQLite, network transport, E2EE, or a reference implementation.

A commit names the group, parent hash, sequence, claimed hash, authority signer, ordered add/remove/replace operations, and signature. The reducer exports canonical unsigned bytes and delegates cryptographic verification to an injected boundary. The boundary has three outcomes: verified, invalid, and unavailable. Unavailable verification produces pending state with `signer-unavailable`, so signer recovery does not become a membership rejection.

The only advancing authority is the configured principal/device signer, which is separate from the active roster in this profile. A commit must extend the current sequence and parent hash, with `parentHash` null if and only if sequence is 1. Missing parents remain pending; known conflicting parents, alternate hashes at one sequence, hash collisions, and descendants of quarantined commits are retained as quarantine results. A conflict preserves the accepted head and sets an explicit `blocked` record; new membership commits return `conflict-blocked` until a later repair operation is defined. Duplicate canonical signed bytes are idempotent. The initial profile enforces one active device per principal and a maximum of 500 active principals, with atomic add/remove/replace transitions. A missing verifier fails closed; trusted fixture tests must inject an explicit verifier.

Batch replay sorts by sequence and hash and every state collection has stable ordering. This gives deterministic replay for the same commit set and explicit verifier outcomes while preserving evidence when a later branch conflicts with an already accepted head.

## Rationale

A group cap cannot be enforced by independent local admission checks during a partition. A single ordered signer gives the initial profile one authoritative sequence, making cap checks and device replacement auditable without introducing consensus or a transport protocol. Keeping verification injectable lets the reducer be model-tested without inventing cryptography and leaves the runtime free to choose a reviewed implementation later.

Pending and quarantine are separate states because absence of a dependency can recover, while a conflicting authority history needs repair. A pure reducer also makes arrival-order, duplicate, and cap-boundary traces executable before persistence and fan-out exist.

## Consequences

- The group package is a domain kernel; callers own persistence, retry scheduling, and authority-key availability signals.
- A signer outage stops membership changes but does not require E2EE or message transport to be present.
- An accepted head is never rewritten when a conflicting branch arrives; the unaccepted branch and pending descendants are quarantined, a visible block stops further advancement, and repair must be explicit.
- Authority transfer, multiple devices, failover, consensus, group keys, and message encryption require later decisions and cannot be inferred from this reducer.
- The 500-principal number remains a profile cap and test target, not a measured network capacity claim.
