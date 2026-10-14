# 0007 Group membership state machine

English | [中文](0007-group-membership-state-machine.zh.md)

Status: implemented reducer kernel; the initial group profile exit evidence remains planned. It defines membership state only; it does not define message encryption or network delivery.

## Profile and authority

A group has at most 500 active member principals. A principal has one active device in this profile, so each active principal contributes exactly one device identity. A group has one designated membership authority, identified by a principal and device pair. The authority identity is separate from the active roster in this profile and cannot be added as a member. Authority transfer, automatic election, multiple active devices, and failover are outside this profile.

The initial state contains a group identifier, authority, optional initial roster, sequence `0`, and no parent hash. The roster must have one device per principal and must not exceed the configured cap. A lower cap may be used by a test profile, but no state may configure a cap above 500.

## Signed commit shape

A commit is an immutable, signed-version-shaped input:

- `groupId`, `sequence` (a positive integer), `parentHash` (null if and only if sequence is 1), and `commitHash`;
- `signer` with `principalId` and `deviceId`;
- an ordered list of membership operations; and
- a non-empty `signature`.

The reducer exposes canonical unsigned JSON bytes. A caller must inject a verifier for signature and hash checks; without one the reducer fails closed. A verifier may return `verified`, `invalid`, or `unavailable`. An unavailable authority key is a pending condition, not a rejection.

## Transitions

A valid commit is signed by the current authority, has sequence `current + 1`, and names the current head hash as its parent. Its operations apply atomically in listed order:

- `add` inserts a principal and device that are not already active;
- `remove` removes the active principal, optionally checking its current device; and
- `replace` changes one principal from an expected old device to a new device.

The authority member cannot be removed or replaced by this profile because authority transfer is a separate decision. A commit that would leave more than the configured active-principal cap is rejected as `over-cap`; no partial operation becomes visible. A failed operation, stale device expectation, duplicate principal, or replacement with the same device is an `invalid-transition` rejection.

## Continuity, replay, and conflicts

The reducer advances only along a contiguous parent-hash and sequence chain. A child received before its parent is retained as `pending` with reason `missing-parent`; once the parent is applied, contiguous pending descendants are retried in sequence/hash order. The same signed bytes applied twice produce `duplicate` and one accepted history record.

A different payload or signature under an accepted `commitHash`, two different hashes at one sequence, a known non-head parent, or a descendant of a quarantined commit produces `quarantined` with a conflict reason. Quarantine preserves the unaccepted input and evidence; it never silently selects a branch. The accepted head and member projection stay intact, while state exposes an explicit `blocked` record containing the divergence sequence, accepted hash, and conflicting hashes. While blocked, new membership commits are rejected with `conflict-blocked` until an explicit repair operation exists. A malformed input, wrong group, invalid signature, or unauthorized signer is `rejected` and does not advance the head.

Batch replay sorts commits by sequence and hash before reduction. Members, accepted records, pending records, quarantine records, and the block evidence have stable ordering, so a fixed commit set and verifier results produce the same state regardless of arrival order. A later conflicting branch cannot rewrite an already accepted head; its commit is quarantined, pending descendants are quarantined, and no new membership-dependent work can advance while the block is visible.

## Observable outcomes

Every application returns the resulting state, the commit hash, `kind`/`status`, an optional reason, and hashes advanced by the call. Consumers must handle these outcomes explicitly:

| Outcome | Meaning |
| --- | --- |
| `applied` | The commit became the contiguous head; pending descendants may also be released. |
| `duplicate` | The exact accepted commit was seen again. |
| `pending` + `missing-parent` | The input is structurally valid but its required chain is not present yet. |
| `pending` + `signer-unavailable` | The authority identity is known, but the injected verification boundary cannot currently verify its signature. |
| `quarantined` | The input conflicts with the accepted or quarantined chain and is preserved for repair. |
| `rejected` + `conflict-blocked` | A prior authority conflict is visible; new membership advancement waits for explicit repair. |
| `rejected` | The input is malformed, unauthorized, cryptographically invalid, or fails an atomic transition/cap check. |

## Boundary and evidence

This package is a deterministic in-process reducer. It does not store state, send commits, discover peers, establish sessions, derive keys, encrypt content, or implement E2EE. Callers own persistence and must retry pending inputs after dependency or signer recovery.

The group package smoke/model trace covers reverse-order replay, duplicate delivery, add/remove/replace transitions, cap rejection, canonical-byte encoding, signer-unavailable pending and release, pending hash collisions, and a blocked conflicting branch. Release evidence must additionally measure 2, 50, 200, and 500 principals and exercise signer loss, conflict repair, reconnect, and queue limits at the transport layer.
