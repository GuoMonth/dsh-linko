# 0007 Group chat capacity and end-to-end encryption boundary

Status: accepted for the design phase.

## Decision

The initial Linko group profile is capped at 500 members. The cap includes human, Agent, and service identities. A group does not create a full mesh of member connections. It uses the same event log and cursor synchronization as one-to-one messaging, with selected delivery paths and bounded fan-out.

Transport encryption and message-layer end-to-end encryption are separate requirements. Linko will not claim end-to-end encryption for group content until message-layer keys are established, rotated, removed, and recovered in tested implementations. MLS is the primary candidate for asynchronous group encryption; the project will use an established implementation and will not invent a cryptographic protocol.

Relays and mailboxes may store encrypted envelopes. Membership and device changes are signed events. A removed device cannot decrypt future protected messages, and historical plaintext is not shared with a new member by default.

## Rationale

Five hundred members gives the first product a useful collaboration room while keeping fan-out, receipt, notification, and key-management tests bounded. The limit is deliberately a product profile rather than a claim about raw LAN bandwidth.

## Consequences

- Group capacity, delivery, and key-rotation evidence become phase gates.
- A transport-only encrypted prototype must be described honestly as such.
- Group UI and Agent policies must expose membership, authorship, and approval state.
- Larger rooms require a later profile with new measurements and explicit protocol work.
