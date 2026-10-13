# 0004 Group chat capacity and end-to-end encryption

English | [中文](0004-group-chat-and-e2ee.zh.md)

Status: draft. Membership authority and encryption selection are explicit decision gates.

## Count the actual participants

The first profile caps a group at 500 active member principals, including human, Agent, and service principals. Propose one active device per principal initially, so the device/key-leaf budget is also 500. Multiple devices require a separate device cap and measurements. This is a product bound, not performance or security evidence.

A local “reject the 501st join” check cannot enforce a hard cap under partitions: two admins seeing 499 members can each admit one, producing 501. Do not ship that rule as sufficient.

## Membership authority proposal

The simplest proposed model is one designated membership signer per group, with a signed version and parent hash. Concurrent proposals are queued or rejected against the current version. Validating clients reject an over-cap commit or a broken parent chain.

This is decentralized between groups and nodes, with centralized membership writes inside one group. If the signer is offline, existing members can exchange messages but membership changes wait. Automatic election, multi-admin consensus, and failover are outside the initial profile. Authority transfer, device replacement, conflict quarantine, and backup recovery must be decided before group implementation.

A valid commit records authority and roster; activation additionally needs required keys. Missing parents remain pending, conflicting children stop membership-dependent operations. This proposal is not yet user-approved. Alternatives require either consensus/coordination or an explicitly weaker cap/availability contract.

## Delivery and receipts

Start with bounded direct fan-out through a connection pool. A 500-member group can require 499 deliveries for one post; LAN bandwidth does not eliminate that cost. Do not establish 500 persistent connections at every node.

Membership, post permission, authorship, Agent delegation, context access, and approval are separate checks. A removed device cannot produce newly authorized group events. Historical valid messages remain auditable.

Private read state stays local by default. Optional shared receipts use bounded event coverage per device and unicast to the author or a specified aggregator. Do not broadcast per-message, per-device read updates to every member. Notification grouping and unread state are separate from network receipts.

Selected relays/mailboxes are a later availability extension. They need explicit quotas, topology, metadata disclosures, and retention. They cannot promise delivery without a reachable authorized copy.

## Encryption decision gate

Authenticated TLS sessions are not message-layer E2EE. A transport-only group prototype must be labeled as such and is not the protected-content release. Non-recipient storage must receive only ciphertext. Meaningful cover text, body, and human surface need the same audience protection; routing metadata remains visible.

Evaluate an established implementation of a reviewed protocol, with MLS as a candidate. Do not invent cryptography, assume MLS transports messages, or claim that it resolves concurrent membership commits automatically. MLS integration must agree with the selected membership ordering and authority.

Before integration, define bounded epoch/commit retention, missed-commit delivery, stale-sender policy, rejoin/Welcome behavior, backup, and user-visible key-recovery states. If keys or required commits are missing, protected sends remain blocked with an explanation; there is no plaintext fallback. Offline catch-up is conditional on authorized retained content and key history.

Removal protects content encrypted under new keys after remaining senders adopt them. It cannot protect content that an unaware offline sender still encrypts with old keys, erase cached plaintext, or retract old ciphertext. New members receive post-join content by default; history sharing is a separate explicit decision.

## Evidence before release

Separate the delivery milestone from the E2EE milestone. The 500 profile needs 2/50/200/500-principal tests at the actual supported device count. Record p95 latency, sender/receiver bytes, queue depth, connection count, receipt amplification, and recovery time.

Required scenarios: concurrent cap-boundary joins, signer loss, conflicting versions, offline members, stale keys, device replacement, removals, late messages, denied history, partial body fetch, and any optional relay failure. Passing a simulation does not establish capacity on Wi-Fi; record hardware, traffic, retention, and network assumptions.
