# 0005 Data and state transitions

English | [中文](0005-state-and-storage.zh.md)

Status: draft design contract. Physical schema, canonical encoding, and numeric budgets remain implementation gates.

## Durable facts and operational state

Use one SQLite database. Keep four domain/storage concepts: immutable signed `event`, content-addressed `object`, locally trusted `peer`, and scoped `sync_checkpoint`. These are concepts, not a four-table mandate.

An event carries its schema version, actor/device, per-actor sequence, kind, audience/scope, causal references, payload hash, and signature. The canonical encoding and hash domain must be specified before fixtures become executable. A principal and its devices are distinct; delegation links an Agent to an authorizing principal without changing authorship.

The node also needs durable mutable operational rows: delivery jobs, approval/action attempts, private read state, notification jobs, and object availability. They cannot all be reconstructed from shared events: private approvals, retry outcomes, and user dismissals are local facts. Rebuildable projections include the inbox, membership view, and collaborator index. JSONL is a versioned export, not a second transactional store.

Content-addressed bodies are immutable; an envelope reference is not evidence that the recipient has the body. Retention and minimal deduplication retention must be specified together before deletion ships.

## Identity, deduplication, and merge

Three identifiers solve different problems:

- `event_id`: hash of the specified canonical unsigned event payload, including actor, scope, and sequence; the signature binds that payload.
- `command_id`: client retry identity, scoped to client, operation, and payload digest; one local command transaction creates at most one event.
- `attempt_id`: one transport or action attempt. Retries never create another copy of the same event.

An identical event ID and canonical bytes is a duplicate. Different bytes under the same ID, or two events with the same actor sequence but different payloads, are conflicts. Preserve evidence and quarantine the affected actor range; never silently pick whichever arrived first. Cryptographic verification happens before trusting a duplicate claim.

There is no universal merge function for every field. The rules are:

| Data | Merge rule |
| --- | --- |
| Immutable messages and independent claims | Set union by event ID; concurrent messages coexist |
| Same issuer's claim updates/revocations | Explicit issuer sequence and supersedes reference; a gap stays pending |
| Other people's opinions | Separate claims; no overwrite or global score |
| Group membership / key epochs | Valid parent/version chain from the selected authority/protocol; no last-writer-wins merge |
| Private operational rows | Local transactions; not merged over the network |
| Shared read receipts | Explicit event coverage per device; union of coverage, bounded batches |

Projection is `project(validatedEventSet, policyVersion, evaluationTime)`. Given the same set and explicit inputs, the result is independent of arrival order. Resolve causal dependencies before projecting dependent events. Missing dependencies stay pending; a conflicting authority chain blocks its descendants and surfaces repair. Do not infer causal precedence from wall-clock time or local insertion order.

Expiry changes current eligibility, not historical authorship. A revoked claim is excluded from current recommendation views while its provenance may be retained. Revocation does not retroactively erase valid history. Compromise recovery and retrospective invalidation need a separate explicit policy. Different trust policies may produce different recommendations from the same claims.

## Separate state dimensions

| Dimension | States / transitions | Meaning |
| --- | --- | --- |
| Outbound job | queued → sending → confirmed; sending → retry_wait → sending; rejected/abandoned terminal | Response loss is uncertainty; retry the same event |
| Recipient storage | unknown → accepted; dependency_pending → usable | accepted means authenticated, durably stored or verified duplicate; pending dependencies cannot authorize effects |
| Recipient inbox | absent → delivered | delivered means committed and available to the authorized recipient inbox; body availability remains separate |
| Human presentation | unseen → presented; explicit viewing/mark-read → read | Per device; notification emission is independent; explicit marking need not render the body |
| Acknowledgement | absent → acknowledged | Explicit human or authorized Agent acknowledgement; never inferred from read |
| Action attempt | requested → awaiting_approval → approved → executing → succeeded/failed/uncertain | Policy can reject or expire pending work; a crash during execution can leave an uncertain outcome |
| Membership proposal | proposed → rejected or committed | Activation follows the validated membership version and required keys |
| Delegation | granted → active → expired/revoked | Rechecked when an action starts; expiry cannot undo an already completed external effect |

A node may atomically make an event both accepted and delivered. These words are observations, not a universal six-step lifecycle. An Agent may act on unread mail; reading cannot approve an action. A summary may say “read on one device,” never “read on every device” without evidence.

Private read markers use the local conversation insertion sequence. Shared receipts name explicit event IDs or validated actor-sequence coverage, never a local sequence from another node. Late-arriving events get a new local position and remain unread. Removed devices cannot publish new authorized read facts; previously valid facts remain history.

Action approval binds the message digest, action ID, audience, authority, and policy version. Check current authorization immediately before executing. Cancellation/expiry during an external call cannot guarantee rollback. Retry an uncertain effect only with a downstream idempotency contract or human reconciliation.

## Cursor scopes

A sync token belongs to its issuing peer, authorized stream/scope, and `log_epoch`. Its local append position is neither an actor sequence nor a global conversation order. Authorization is rechecked for every pull.

A rebuilt log or incompatible retention boundary invalidates old tokens. Return an explicit reset requirement and a bounded authorized snapshot-plus-delta path; never return an empty success that silently skips data. A client persists a received batch and its next checkpoint in the same transaction. WSS live traffic cannot advance that recovery checkpoint; only the canonical REST cursor path does so after durable persistence.

## Validation and transaction boundaries

Reject oversized frames before parsing; then check schema/version, canonical hash, signature, scope/authorization, dependency/version consistency, and deduplication. Rate and byte limits apply even to valid signatures. Structurally valid events missing dependencies use bounded pending storage, not an unbounded rejection/retry loop.

In one receive transaction: append verified event or duplicate result, update deduplication and inbox/projection state, enqueue any receipt, and commit the corresponding checkpoint. Only after durable commit may the node report accepted/delivered. The reference durability candidate is SQLite WAL with `synchronous=FULL`; supported-platform crash tests must confirm the actual behavior before claiming durability.

In one send transaction: persist command idempotency, event, and delivery job. Send after commit; record the response afterward. A crash after send causes a duplicate retry, never a new event. On restart, unfinished sends are retried; action attempts in executing become uncertain; partial objects remain unavailable until verified.

Record approval and action work atomically. Notifications, sockets, object fetches, and external tools run outside the transaction. Their completion is recorded separately; no database transaction can make a remote side effect exactly once.

## Invariants and fixtures

1. One accepted event ID binds one canonical payload.
2. No receipt or checkpoint acknowledges uncommitted data.
3. Duplicate network delivery creates one inbox item.
4. Delivery/read/acknowledgement never grants execution authority.
5. Missing or conflicting membership/key dependencies cannot authorize an action.
6. Private mutable state is not accidentally replicated as a signed public fact.
7. Same event set, policy version, and evaluation time produce the same domain projection.
8. Revocation blocks new effects once observed; offline peers cannot enforce unknown revocations.

Each future fixture includes a schema version, initial state, explicit clock/policy inputs, ordered commands or arrival permutations, expected events/projections, and expected error codes. Keep the fixture format language-neutral; no implementation-generated expected output.

Required traces include duplicate/conflicting IDs, author equivocation, missing parents, crash before/after commit and after send, old-epoch cursors, late unread events, approval expiry, uncertain tool execution, concurrent membership changes at the cap, stale keys, and corrupt/missing bodies. Passing these is future implementation evidence, not a claim made by this document.
