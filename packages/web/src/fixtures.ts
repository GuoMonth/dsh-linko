/**
 * Fixture envelopes for the offline preview.
 *
 * These exist so the inbox can be opened, reviewed and exercised before a node
 * is running. They are plain data passed through `parseEnvelope`, which means
 * the fixtures and the network path share one narrowing step — a fixture that
 * the runtime would reject cannot silently render here either.
 *
 * Timestamps are derived from the caller's clock so the preview reads as
 * current, and `scripts/smoke.mjs` can pass a fixed clock for determinism.
 */

import { parseEnvelope, type Envelope } from './model.js';

const MINUTE = 60_000;

function envelope(now: number, offsetMinutes: number, value: unknown): Envelope {
  const parsed = parseEnvelope({
    ...(value as Record<string, unknown>),
    receivedAt: now - offsetMinutes * MINUTE,
  });
  if (parsed === null) {
    throw new Error('Fixture envelope failed the shared validator.');
  }
  return parsed;
}

export function fixtureEnvelopes(now: number): Envelope[] {
  const expiresSoon = new Date(now + 42 * MINUTE).toISOString();
  const expired = new Date(now - 18 * MINUTE).toISOString();

  return [
    // The primary case: a delegated Agent asking a person to approve something,
    // with the requesting device's own view of delivery still short of a reply.
    envelope(now, 4, {
      id: 'sha256:9f2c1a70b4e5d8c3',
      kind: 'collaboration.request',
      cover: {
        title: 'Review a proposed collaborator for the parser task',
        preview: 'Please approve the suggested reviewer before I share the task context.',
        actor: { kind: 'agent-delegated', id: 'agent:linko', composerId: 'agent:linko', delegatorId: 'person:lin' },
        status: 'needs-human-approval',
      },
      semantic: {
        intent: 'request',
        contextRefs: ['ctx_parser_bench', 'project:linko'],
        availableActions: ['approve', 'reject', 'inspect'],
      },
      policy: { risk: 'medium', requiresApproval: true, expiresAt: expiresSoon, hopLimit: 4, fanoutLimit: 3 },
      inlineBody:
        'Wei has reviewed two parser benchmarks in this project and their evidence is signed. Sharing the task context would disclose the benchmark fixtures but not the private notes.',
      surfaceRef: { surfaceId: 'surface_review_card', version: 3 },
      facts: {
        outbound: 'confirmed',
        storage: 'usable',
        inbox: 'delivered',
        acknowledgement: 'absent',
        action: 'awaiting_approval',
        delegation: 'active',
        devices: [
          { deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'read' },
          { deviceId: 'dev_lin_phone', label: 'Phone', presentation: 'unseen' },
        ],
      },
    }),

    // Autonomous Agent, high risk, no delegation. Must never read as human.
    envelope(now, 11, {
      id: 'sha256:41ba7d0c9e6f2a55',
      kind: 'agent.proposal',
      cover: {
        title: 'Re-index the shared object cache tonight',
        preview: 'I can reclaim about 4 GB by dropping objects no envelope references.',
        actor: { kind: 'agent-autonomous', id: 'agent:janitor' },
        status: 'needs-human-approval',
      },
      semantic: {
        intent: 'command',
        contextRefs: ['cache:objects'],
        availableActions: ['approve', 'reject'],
      },
      policy: { risk: 'high', requiresApproval: true, expiresAt: expiresSoon, hopLimit: 2, fanoutLimit: 1 },
      inlineBody:
        'Deletion cannot be undone once the retention window closes. I have listed the candidate objects but have not removed anything.',
      facts: {
        outbound: 'confirmed',
        storage: 'accepted',
        inbox: 'delivered',
        acknowledgement: 'absent',
        action: 'requested',
        delegation: null,
        devices: [{ deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'unseen' }],
      },
    }),

    // Cover available while the body holder is offline: the point of the split.
    envelope(now, 26, {
      id: 'sha256:7c0de912ab34f681',
      kind: 'collaboration.request',
      cover: {
        title: 'Provide the signing key fingerprint for the new node',
        preview: 'Body is held by a peer that is currently unreachable.',
        actor: { kind: 'agent-delegated', id: 'agent:enroll', composerId: 'agent:enroll', delegatorId: 'person:rita' },
        status: 'needs-human-approval',
      },
      semantic: {
        intent: 'request',
        contextRefs: ['pairing:node-7'],
        availableActions: ['approve', 'reject'],
      },
      policy: { risk: 'medium', requiresApproval: true, expiresAt: expiresSoon, hopLimit: 3, fanoutLimit: 1 },
      bodyRef: { scheme: 'linko', objectId: 'sha256:bb19e4f7c2d0a8e3' },
      facts: {
        outbound: 'retry_wait',
        storage: 'dependency_pending',
        inbox: 'delivered',
        acknowledgement: 'absent',
        action: 'awaiting_approval',
        delegation: 'active',
        devices: [{ deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'presented' }],
      },
    }),

    // A person writing directly. No approval gate, nothing queued for execution.
    envelope(now, 52, {
      id: 'sha256:2ad4f8801c7b93ee',
      kind: 'message.note',
      cover: {
        title: 'Benchmarks moved to the shared volume',
        preview: 'The old fixture paths still resolve, but update your scripts when you can.',
        actor: { kind: 'human', id: 'person:wei' },
        status: 'informational',
      },
      semantic: { intent: 'inform', contextRefs: ['project:linko'], availableActions: ['inspect'] },
      policy: { risk: 'low', requiresApproval: false, expiresAt: null, hopLimit: 5, fanoutLimit: 8 },
      inlineBody: 'Nothing here needs a decision. I kept the previous paths as symlinks for a week.',
      facts: {
        outbound: 'confirmed',
        storage: 'usable',
        inbox: 'delivered',
        acknowledgement: 'acknowledged',
        action: 'requested',
        delegation: null,
        devices: [
          { deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'read' },
          { deviceId: 'dev_lin_phone', label: 'Phone', presentation: 'read' },
        ],
      },
    }),

    // Expiry: policy can expire pending work. Approval must be refused.
    envelope(now, 73, {
      id: 'sha256:5e91cc3a7d20b6f4',
      kind: 'collaboration.request',
      cover: {
        title: 'Extend the relay mailbox lease',
        preview: 'This request has expired and can no longer be approved.',
        actor: { kind: 'agent-delegated', id: 'agent:relay', composerId: 'agent:relay', delegatorId: 'person:lin' },
        status: 'expired',
      },
      semantic: { intent: 'request', contextRefs: ['relay:mailbox-2'], availableActions: ['inspect'] },
      policy: { risk: 'medium', requiresApproval: true, expiresAt: expired, hopLimit: 3, fanoutLimit: 1 },
      facts: {
        outbound: 'confirmed',
        storage: 'usable',
        inbox: 'delivered',
        acknowledgement: 'absent',
        action: 'awaiting_approval',
        delegation: 'expired',
        devices: [{ deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'read' }],
      },
    }),

    // Already executed. The reversal window has closed; undo must not be offered.
    envelope(now, 96, {
      id: 'sha256:0b6af245de17c9a2',
      kind: 'agent.proposal',
      cover: {
        title: 'Publish the collaborator recommendation',
        preview: 'Approved and executed. The recommendation is now visible to the project.',
        actor: { kind: 'agent-delegated', id: 'agent:linko', composerId: 'agent:linko', delegatorId: 'person:lin' },
        status: 'done',
      },
      semantic: { intent: 'suggest', contextRefs: ['ctx_parser_bench'], availableActions: ['inspect'] },
      policy: { risk: 'low', requiresApproval: true, expiresAt: null, hopLimit: 4, fanoutLimit: 3 },
      facts: {
        outbound: 'confirmed',
        storage: 'usable',
        inbox: 'delivered',
        acknowledgement: 'acknowledged',
        action: 'succeeded',
        delegation: 'active',
        devices: [{ deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'read' }],
      },
    }),

    // A crash during execution leaves an uncertain outcome that needs a person.
    envelope(now, 118, {
      id: 'sha256:c73f0e5b81da4c26',
      kind: 'agent.proposal',
      cover: {
        title: 'Rotate the group key for the review room',
        preview: 'The node stopped mid-execution. The outcome is unconfirmed.',
        actor: { kind: 'agent-delegated', id: 'agent:keys', composerId: 'agent:keys', delegatorId: 'person:rita' },
        status: 'needs-reconciliation',
      },
      semantic: { intent: 'delegate', contextRefs: ['group:review-room'], availableActions: ['inspect'] },
      policy: { risk: 'high', requiresApproval: true, expiresAt: null, hopLimit: 2, fanoutLimit: 1 },
      inlineBody: 'Retry only with a downstream idempotency contract, or reconcile by hand.',
      facts: {
        outbound: 'confirmed',
        storage: 'usable',
        inbox: 'delivered',
        acknowledgement: 'acknowledged',
        action: 'uncertain',
        delegation: 'active',
        devices: [{ deviceId: 'dev_lin_laptop', label: 'Workstation', presentation: 'read' }],
      },
    }),

    // Node-generated, no authorship to attribute and nothing to approve.
    envelope(now, 140, {
      id: 'sha256:d0a17f3c64be9205',
      kind: 'sync.checkpoint',
      cover: {
        title: 'Sync checkpoint advanced',
        preview: 'Segment 4 of the local log was acknowledged by peer node-7.',
        actor: { kind: 'system', id: 'node:local' },
        status: 'informational',
      },
      semantic: { intent: 'inform', contextRefs: [], availableActions: [] },
      policy: { risk: 'low', requiresApproval: false, expiresAt: null, hopLimit: 1, fanoutLimit: 1 },
      facts: {
        outbound: 'confirmed',
        storage: 'usable',
        inbox: 'delivered',
        acknowledgement: 'absent',
        action: 'requested',
        delegation: null,
        devices: [],
      },
    }),
  ];
}
