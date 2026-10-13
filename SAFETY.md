# Safety

English | [中文](SAFETY.zh.md)

Linko is experimental design-stage software. It is not a security boundary, identity provider, or guarantee that a LAN is trusted.

The intended runtime will exchange task context, signed claims, attachments, and agent-authored messages. Incorrect policies, malicious peers, prompt injection, implementation defects, or accidental sharing can expose private information or cause an agent to take an unwanted action.

Before a runtime exists, treat every protocol example as a design artifact. When implementation begins:

- pair devices explicitly and verify node identity;
- share the smallest context needed for a task;
- make agent authorship and authority visible;
- expire and revoke claims;
- test duplicate, replayed, oversized, malformed, and unauthorized events;
- do not expose the LAN listener beyond the intended network without a separate threat model.
- treat transport encryption and message-layer end-to-end encryption as separate claims;
- keep group rooms within the 500-member design profile until a larger profile has evidence;
- fail closed for protected group content when keys are missing or membership is stale.

Linko is provided under the MIT License without warranty. Do not use an unreviewed build for sensitive workloads.
