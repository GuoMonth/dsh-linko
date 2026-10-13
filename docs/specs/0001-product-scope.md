# 0001 Product scope

English | [中文](0001-product-scope.zh.md)

Status: draft.

## Problem

An Agent can often identify that it needs help, but the useful collaborator, relevant context, and reply authority are distributed across people and other Agents. A message transport alone does not explain who should be asked, what an Agent is allowed to say on a person's behalf, or how a recipient can recover after a connection fails.

## Product statement

Linko is a local-first collaboration mesh for DeepSeek Harness. It maintains scoped, evidence-backed capability claims; recommends collaborators for a task; packages each request as a human-readable and machine-readable envelope; moves the request through a bounded LAN/P2P network; and returns inbound work to a human-controlled reply policy.

The first transport profile is deliberately ordinary: a local node, SQLite, REST synchronization, WebSocket acceleration, direct peer delivery, and bounded discovery. Advanced router, switch, QUIC, or WebTransport features may improve the ceiling but are not installation requirements.

## First users

- A developer running DeepSeek Harness on more than one workstation in one physical environment.
- A small team that wants Agents to ask each other for focused help without moving private context to a central service.
- A team that needs a group room of up to 500 people, Agents, and service identities with explicit membership and approval policy.
- An Agent or plugin author who wants a documented protocol and SDK rather than a product-specific chat integration.

## Invariants

1. A LAN connection is not a trust decision.
2. Every shared claim has an author, scope, lifetime, and provenance.
3. A derived recommendation remains explainable and user-specific.
4. An inbound request cannot silently grant an Agent more authority than the recipient policy allows.
5. Human-authored, delegated Agent, autonomous Agent, and system messages are distinguishable at the protocol level.
6. Envelope covers remain useful when a body peer or UI surface is unavailable.
7. Accepted, delivered, presented, read, acknowledged, and acted states are distinct.
8. REST cursor synchronization can recover any WebSocket interruption.
9. Discovery, query expansion, and ledger synchronization have independent budgets.
10. Conflicts remain inspectable; merging does not erase competing claims.
11. The system can operate locally without a required central coordinator.
12. The initial group profile rejects membership above 500 participants.
13. Group transport encryption and message-layer end-to-end encryption are described separately.

## First user journeys

### Find and ask a collaborator

1. A user asks Linko to find help with a concrete task.
2. Linko searches the local projection and selected peers within a stated budget.
3. The recommendation shows candidates, evidence, freshness, and the reason for the ranking.
4. The user approves a scoped request and selects the context to share.
5. The recipient sees a compact envelope cover and chooses whether to open details, delegate a reply, or ignore it.
6. The reply returns with authorship, evidence, delivery state, and any requested follow-up authority.

### Work in a group

1. A member joins a group after an explicit membership decision.
2. A node synchronizes group events through selected peer sessions rather than a full mesh.
3. Human and Agent messages are visibly distinct.
4. Agent posts and context sharing follow the group's policy and approval gates.
5. Offline members catch up from encrypted event ranges after reconnecting.

## Initial non-goals

- A public blockchain, token, mining, or financial incentive.
- A universal reputation score for people or Agents.
- A full replacement for team chat or project management software.
- A central cloud directory required for normal LAN operation.
- Automatic sharing of a user's complete conversation history.
- Unbounded gossip, full-mesh connections, or discovery by payload broadcast.
- Dependence on a router, switch, VLAN, QoS, 802.1X, or firewall feature for basic messaging.
- Arbitrary remote HTML or JavaScript as a trusted UI or authority source.
- Group rooms above 500 members in the first protocol profile.
- Claiming group end-to-end encryption before a tested message-layer protocol exists.
- Copying or adapting implementation code from Rellopn/dsh-p2p-lan.

## Acceptance questions

- Can a user understand why a person or Agent was recommended?
- Can a user see exactly which context leaves the device?
- Can a recipient limit an Agent to draft-only, topic-specific, or approval-gated replies?
- Can a cover be rendered from local storage while the body peer is offline?
- Can two nodes converge after reconnecting without replaying the complete ledger?
- Can a WebSocket interruption recover through REST without duplicate inbox messages?
- Can a 500-member group handle membership changes, offline catch-up, receipts, and Agent approvals within measured budgets?
- Can protected group content fail closed when keys are unavailable?
- Can the network reject repeated, expired, oversized, malformed, or unauthorized events?
