# 0001 Product scope

English | [中文](0001-product-scope.zh.md)

Status: draft.

## Problem

An agent can often identify that it needs help, but the useful collaborator, relevant context, and reply authority are distributed across people and other agents. A message transport alone does not explain who should be asked or what an agent is allowed to say on a person's behalf.

## Product statement

Linko is a local-first collaboration mesh for DeepSeek Harness. It maintains scoped, evidence-backed capability claims; recommends collaborators for a task; moves a task request through a bounded LAN overlay; and returns inbound work to a human-controlled reply policy.

## First users

- A developer running DeepSeek Harness on more than one workstation in one trusted physical environment.
- A small team that wants agents to ask each other for focused help without moving private context to a central service.
- An agent or plugin author who wants a documented protocol and SDK rather than a product-specific chat integration.

## Invariants

1. A LAN connection is not a trust decision.
2. Every shared claim has an author, scope, lifetime, and provenance.
3. A derived recommendation remains explainable and user-specific.
4. An inbound request cannot silently grant an agent more authority than the recipient policy allows.
5. Discovery, query expansion, and ledger synchronization have independent budgets.
6. Conflicts remain inspectable; merging does not erase the competing claims.
7. The system can operate locally without a central coordinator.
8. Human-authored and agent-authored messages are distinguishable.

## First user journey

1. A user asks Linko to find help with a concrete task.
2. Linko searches the local projection and selected peers within a stated budget.
3. The recommendation shows candidates, evidence, freshness, and the reason for the ranking.
4. The user approves a scoped request and selects the context to share.
5. The recipient receives the request in an inbox. Their policy shows whether an agent may draft or send a reply.
6. The reply returns with authorship, evidence, and any requested follow-up authority.

## Initial non-goals

- A public blockchain, token, mining, or financial incentive.
- A universal reputation score for people or agents.
- A full replacement for team chat or project management software.
- A central cloud directory required for normal LAN operation.
- Automatic sharing of a user's complete conversation history.
- Unbounded gossip, full-mesh connections, or discovery by payload broadcast.
- Copying or adapting implementation code from Rellopn/dsh-p2p-lan.

## Acceptance questions

- Can a user understand why a person or agent was recommended?
- Can a user see exactly which context leaves the device?
- Can a recipient limit an agent to draft-only or topic-specific replies?
- Can two nodes converge after reconnecting without replaying the complete ledger?
- Can the network reject repeated, expired, oversized, malformed, or unauthorized events?
