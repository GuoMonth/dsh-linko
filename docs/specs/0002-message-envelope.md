# 0002 Message envelope and conversation semantics

English | [中文](0002-message-envelope.zh.md)

Status: draft.

## Scope

A Linko message is an immutable envelope that can be delivered, stored, opened, cited, and acted on without depending on one UI. The envelope supports short human messages, Agent requests, evidence, attachments, and constrained human surfaces.

## Envelope parts

- **Cover**: a small, always-available projection for the inbox.
- **Body reference**: inline content or a content-addressed encrypted object.
- **Surface reference**: a constrained, replayable human UI description.
- **Seal and policy**: actor, audience, hashes, expiry, delegation, and bounded consequences.

The cover lets a person decide whether to open, defer, mute, or approve without fetching the body. Larger content is fetched only after the cover and policy are stored. A link is a reference, not a delivery guarantee.

The canonical envelope never changes. Delivery, presentation, read, acknowledgement, approval, and execution are independent facts or attempts defined in [0005](0005-state-and-storage.md). A later receipt cannot rewrite authorship or grant authority.

## Authorship

Every envelope identifies its creating actor:

- \`human\`: written and sent by a person;
- \`agent-delegated\`: written or sent under a human delegation;
- \`agent-autonomous\`: created under an Agent's local policy;
- \`system\`: produced by a node for transport or synchronization.

Author, composer, sender, and delegator remain separate fields. A signature proves control of a key over an asserted author; it does not prove that a person typed the text. An autonomous Agent message must never be rendered as human-authored.

## Agent policy

The first intent vocabulary is \`inform\`, \`suggest\`, \`request\`, \`delegate\`, and \`command\`. A recipient may automatically accept informative events. External side effects, context disclosure, fan-out, and further delegation require an explicit capability and may require a human approval.

Risk, approval, expiry, hop, fan-out, and byte budgets constrain consequences. A client-supplied dedupe key is not a second identity for the message; retry identity belongs to the command or delivery attempt. Policy fields cannot turn prose into executable authority.

Delegations have their own signed grant and revoke/expiry events. The recipient checks the current policy and delegation again immediately before executing an action. A message whose delegation has expired remains auditable but cannot create a new side effect.

## Human and Agent projections

The stable semantic payload is machine-readable: typed facts, stable identifiers, status, constraints, context references, and available actions. The human projection has a title, short explanation, provenance, status, and progressive detail. The cover must render without asking an Agent to rewrite it.

An Agent can request a scoped detail reference and should receive the smallest object needed for the current decision. HTML, CSS, and JavaScript are rendering formats, never authority. A surface is either a known safe component or displayed as inert text.

## Independent delivery and reading facts

The protocol does not use one enum for all message status:

- the transport attempt can be queued, sending, accepted, retried, rejected, or abandoned;
- recipient storage can become \`delivered\` after a durable commit;
- a device can be \`presented\` or \`read\`;
- a person or authorized Agent can explicitly \`acknowledged\`;
- an action has its own approval and execution attempt.

\`accepted\` is a receiver observation, not human approval. \`delivered\` never means read. \`read\` never means acknowledged. \`acted\` is an effect record and may occur without read. Per-device facts are retained; an aggregate may say “read on one device” and must not imply “read on every device.”

Private read markers use local conversation positions. Shared read receipts name event IDs or validated author-sequence ranges, are bounded, and are sent only to the author or an agreed aggregator. They are not broadcast to every group member.

## Example shape

\`\`\`json
{
  "id": "sha256:...",
  "kind": "collaboration.request",
  "cover": {
    "title": "Review a proposed collaborator",
    "preview": "Please approve the suggested reviewer",
    "actor": { "kind": "agent-delegated", "id": "agent:linko" },
    "status": "needs-human-approval"
  },
  "semantic": {
    "intent": "request",
    "contextRefs": ["ctx_123"],
    "availableActions": ["approve", "reject", "inspect"]
  },
  "bodyRef": { "scheme": "linko", "objectId": "sha256:..." },
  "surfaceRef": { "scheme": "linko", "surfaceId": "surface_456", "version": 3 },
  "policy": {
    "risk": "medium",
    "requiresApproval": true,
    "expiresAt": "..."
  },
  "seal": { "contentHash": "sha256:...", "signature": "..." }
}
\`\`\`

## Acceptance evidence

- The inbox can show the cover while the body holder is offline.
- Human, delegated Agent, autonomous Agent, and system authorship are distinguishable.
- Duplicate delivery creates one canonical message and multiple attempts.
- A receipt cannot rewrite the envelope or grant authority.
- A person can inspect sender, delegation, context, audience, and actions before approving.
- The UI displays delivery, read, acknowledgement, and action facts independently.
