# 0008 Action approval policy boundary

English | [中文](0008-action-policy-boundary.zh.md)

Status: accepted MVP boundary.

## Approval gate

The node treats an approval receipt as a policy decision, not as a generic status update. An `approved` receipt is accepted only when the immutable envelope has `policy.requiresApproval === true` and the selected `actionId` is present in `semantic.availableActions`. The action must still be `requested` or `awaiting_approval`; a missing action request, a terminal decision, or an identity mismatch fails closed. A rejection may record a requested action without granting approval.

The reducer is pure and deterministic. Callers provide the envelope, event digest, action ID, prior attempt, device ID, and evaluation timestamp. It returns either an accepted decision or a bounded error; execution, notifications, and external tools remain outside this boundary.

## Expiry

`policy.expiresAt` is either `null`/absent or an ISO timestamp accepted by the node wire profile. A malformed or non-string value is rejected at the decision boundary. Approval is expired when the evaluation instant is equal to or later than `expiresAt`; rejection remains a local decision and does not execute work.

## Decision identity

The local action row binds a decision to the event digest (the content-derived event ID), action ID, audience, authority, policy version, and approving device. Audience, authority, and policy version are recorded when present in the envelope; the current profile falls back to the actor for authority and stores missing protocol fields as null. A repeated decision with the same binding is idempotent. A different device, policy identity, action, or terminal state is rejected.

The wire shape of `POST /v1/receipts` is unchanged. Signed authorship, delegation verification, group membership/key epochs, policy authorization lookup, and execution attempt effects remain deferred until their respective protocol decisions and storage contracts exist.
