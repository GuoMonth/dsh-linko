# 0007 Group chat capacity and E2EE boundary

English | [中文](0007-group-chat-and-e2ee-boundary.zh.md)

Status: proposed profile; membership authority is a decision gate.

## Decision

The first group profile caps 500 active member principals and initially permits one active device per principal. The cap is enforceable only through a group-local designated membership signer with a signed version and parent hash. Messages may use direct bounded fan-out; the group does not require a full mesh.

Transport encryption and message-layer E2EE remain separate. MLS is a candidate, not a selected implementation or a delivery system. Protected group content cannot silently fall back to plaintext. Removal and offline behavior must be described in terms of key epochs and sender adoption, not promises of retroactive secrecy.

Read state is private by default. Shared receipts are bounded and unicast to the author or a specified aggregator. They are not per-message, per-device broadcasts to the group.

## Rationale

A hard cap needs a serialization point. Choosing one group-local signer is simpler and more honest than pretending concurrent partitioned admins can enforce a global count with local checks. It preserves peer-to-peer message transport while acknowledging that membership writes are coordination.

## Consequences

- Existing members can communicate while the signer is unavailable; membership changes wait.
- Signer loss, transfer, backup, conflict quarantine, and multiple devices need a later decision.
- Group delivery and E2EE have separate milestones and reports.
- A 500-member product test is not a capacity or security proof.
