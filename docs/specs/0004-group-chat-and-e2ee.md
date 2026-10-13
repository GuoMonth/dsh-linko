# 0004 Group chat capacity and end-to-end encryption

English | [中文](0004-group-chat-and-e2ee.zh.md)

Status: draft.

## Scope

The first Linko group chat profile supports at most 500 members, including people, Agents, and service identities. This is a product and protocol limit for the initial profile, not a claim that a LAN cannot carry more traffic. A client MUST reject a membership change that would exceed the profile limit.

## Group model

A group is an event stream with a stable group ID, membership events, per-sender sequence numbers, and a policy describing who may invite, remove, post, request context, and approve Agent actions. The group event log is replicated selectively. A member receives events addressed to the group only after membership and visibility checks.

The protocol does not create a full mesh of 500 WebSocket connections per member. A node maintains a small set of peer sessions and uses direct delivery, selected relays, or a bounded topic mesh. Group fan-out is a delivery concern; group semantics remain in the event log.

The UI MUST distinguish:

- a human-authored message;
- a delegated Agent message;
- an autonomous Agent message;
- a system membership, receipt, or synchronization event.

Agent messages in a group carry an intent, scope, expiry, and action policy. A group administrator MAY require human approval for Agent posts, context sharing, invitations, and fan-out.

## Encryption boundary

Transport encryption protects a single peer session. It does not protect a message from a mailbox or relay. Group message content MUST be encrypted at the message layer before it is stored by a relay that is not an intended recipient.

Linko will not invent a cryptographic protocol. The design will evaluate an established asynchronous group protocol, with IETF Messaging Layer Security (MLS) as the primary candidate for the group profile. The evaluation must cover membership changes, offline members, device addition and removal, forward secrecy, post-compromise security, key recovery, and implementation availability.

Until group message-layer encryption is implemented and tested, the product MUST describe group transport as authenticated and encrypted in transit rather than as end-to-end encrypted. A group that cannot establish the required keys MUST fail closed for protected content instead of silently downgrading.

## Key and membership events

Key changes, membership changes, and device changes are signed events with an auditable author and effective time. Removing a device MUST prevent it from decrypting future protected messages. A member joining a group MUST NOT automatically receive historical plaintext without an explicit history-sharing decision.

The cover may expose the minimum metadata required for delivery and notification. The body, evidence, and UI surface are encrypted or capability-protected according to the group policy.

## Capacity evidence

Before the 500-member profile is released, tests must cover at least 2, 50, 200, and 500 members, including:

- join, leave, invite, and device replacement;
- offline catch-up and reconnect;
- message fan-out and deduplication;
- receipt and notification volume;
- key rotation and failed key installation;
- one or more relay nodes becoming unavailable.

The test report must include p95 delivery latency, bytes per member, pending queue size, duplicate event rate, and recovery time.
