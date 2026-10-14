import assert from 'node:assert/strict';
import {
  applyCommit,
  applyCommits,
  canonicalUnsignedCommit,
  canonicalUnsignedCommitBytes,
  createGroupState,
} from './dist/index.js';

const authority = { principalId: 'membership-authority', deviceId: 'authority-device' };
const verifier = ({ commit }) => {
  if (commit.commitHash === 'pending-signer' && !verifier.available) return 'unavailable';
  return 'verified';
};
verifier.available = false;
const trusted = { verifyCommit: ({ unsignedBytes }) => {
  assert.equal(unsignedBytes instanceof Uint8Array, true, 'verifier receives canonical UTF-8 bytes');
  return 'verified';
} };

const commit = (commitHash, sequence, parentHash, operations) => ({
  groupId: 'smoke-group',
  sequence,
  parentHash,
  commitHash,
  signer: authority,
  operations,
  signature: `signature:${commitHash}`,
});

const first = commit('h1', 1, null, [{ kind: 'add', principalId: 'alice', deviceId: 'alice-1' }]);
const second = commit('h2', 2, 'h1', [{ kind: 'add', principalId: 'bob', deviceId: 'bob-1' }]);
const replaced = commit('h3', 3, 'h2', [{ kind: 'replace', principalId: 'alice', oldDeviceId: 'alice-1', newDeviceId: 'alice-2' }]);
const removed = commit('h4', 4, 'h3', [{ kind: 'remove', principalId: 'bob', deviceId: 'bob-1' }]);

const initial = createGroupState({ groupId: 'smoke-group', authority, maxPrincipals: 2 });
assert.equal(applyCommit(initial, first).kind, 'rejected', 'missing verifier fails closed');
assert.equal(canonicalUnsignedCommit(first), '{"groupId":"smoke-group","sequence":1,"parentHash":null,"signer":{"principalId":"membership-authority","deviceId":"authority-device"},"operations":[{"kind":"add","principalId":"alice","deviceId":"alice-1"}]}');
assert.equal(new TextDecoder().decode(canonicalUnsignedCommitBytes(first)), canonicalUnsignedCommit(first));
assert.equal(applyCommit(initial, { ...first, parentHash: 'unexpected-parent' }, trusted).reason, 'malformed');
assert.equal(applyCommit(initial, commit('authority-add', 1, null, [{ kind: 'add', principalId: authority.principalId, deviceId: 'another-device' }]), trusted).reason, 'invalid-transition');
const reverse = applyCommits(initial, [removed, replaced, second, first], trusted);
const ordered = applyCommits(initial, [first, second, replaced, removed], trusted);
assert.deepEqual(reverse.state, ordered.state, 'batch replay is arrival-order independent');
assert.deepEqual(reverse.state.members, [{ principalId: 'alice', deviceId: 'alice-2' }]);
assert.equal(reverse.state.sequence, 4);

const duplicate = applyCommit(reverse.state, removed, trusted);
assert.equal(duplicate.kind, 'duplicate');

const cap = applyCommit(reverse.state, commit('h5', 5, 'h4', [{ kind: 'add', principalId: 'carol', deviceId: 'carol-1' }]), trusted);
assert.equal(cap.kind, 'applied', 'a remove at the prior version left one available slot');
const overCap = applyCommit(cap.state, commit('h6', 6, 'h5', [
  { kind: 'add', principalId: 'dave', deviceId: 'dave-1' },
  { kind: 'add', principalId: 'erin', deviceId: 'erin-1' },
]), trusted);
assert.equal(overCap.kind, 'rejected');
assert.equal(overCap.reason, 'over-cap');

const fiveHundred = createGroupState({
  groupId: 'smoke-group',
  authority,
  initialMembers: Array.from({ length: 500 }, (_, index) => ({ principalId: `p-${index}`, deviceId: `d-${index}` })),
});
const fiveHundredCap = applyCommit(fiveHundred, commit('cap-500', 1, null, [{ kind: 'add', principalId: 'p-500', deviceId: 'd-500' }]), trusted);
assert.equal(fiveHundredCap.kind, 'rejected');
assert.equal(fiveHundredCap.reason, 'over-cap');

const bounded = createGroupState({
  groupId: 'smoke-group',
  authority,
  limits: { maxPendingCommits: 1, maxPendingBytes: 100_000, maxOperationsPerCommit: 1 },
});
const waitingForParent = applyCommit(bounded, commit('gap-a', 2, 'missing', [{ kind: 'add', principalId: 'a', deviceId: 'a-1' }]), trusted);
assert.equal(waitingForParent.kind, 'pending');
const pendingOverflow = applyCommit(waitingForParent.state, commit('gap-b', 3, 'gap-a', [{ kind: 'add', principalId: 'b', deviceId: 'b-1' }]), trusted);
assert.equal(pendingOverflow.kind, 'rejected');
assert.equal(pendingOverflow.reason, 'pending-limit');
const operationOverflow = applyCommit(bounded, commit('ops-overflow', 1, null, [
  { kind: 'add', principalId: 'a', deviceId: 'a-1' },
  { kind: 'add', principalId: 'b', deviceId: 'b-1' },
]), trusted);
assert.equal(operationOverflow.reason, 'operation-limit');

const signerState = createGroupState({ groupId: 'smoke-group', authority });
const waiting = commit('pending-signer', 1, null, [{ kind: 'add', principalId: 'alice', deviceId: 'alice-1' }]);
const pending = applyCommit(signerState, waiting, { verifyCommit: verifier });
assert.equal(pending.kind, 'pending');
assert.equal(pending.reason, 'signer-unavailable');
verifier.available = true;
const released = applyCommit(pending.state, waiting, { verifyCommit: verifier });
assert.equal(released.kind, 'applied');
assert.equal(released.state.sequence, 1);

const collisionVerifier = ({ commit }) => commit.commitHash === 'pending-collision' ? 'unavailable' : 'verified';
const collisionState = createGroupState({ groupId: 'smoke-group', authority });
const collisionA = commit('pending-collision', 1, null, [{ kind: 'add', principalId: 'collision-a', deviceId: 'collision-a-1' }]);
const collisionB = { ...collisionA, signature: 'signature:pending-collision:other' };
const pendingCollisionA = applyCommit(collisionState, collisionA, { verifyCommit: collisionVerifier });
const pendingCollisionB = applyCommit(pendingCollisionA.state, collisionB, { verifyCommit: collisionVerifier });
assert.equal(pendingCollisionB.state.pending.length, 2, 'different pending payloads under one hash are retained');
const quarantinedCollision = applyCommit(pendingCollisionB.state, collisionB, trusted);
assert.equal(quarantinedCollision.kind, 'quarantined');
assert.equal(quarantinedCollision.state.pending.length, 0);
assert.equal(quarantinedCollision.state.quarantined.length, 2, 'pending hash collision preserves both variants');

const forged = applyCommit(released.state, { ...waiting, groupId: 'other-group' }, trusted);
assert.equal(forged.kind, 'rejected');
assert.equal(forged.reason, 'wrong-group');

const conflictState = createGroupState({ groupId: 'smoke-group', authority });
const branchA = commit('branch-a', 1, null, [{ kind: 'add', principalId: 'a', deviceId: 'a-1' }]);
const branchB = commit('branch-b', 1, null, [{ kind: 'add', principalId: 'b', deviceId: 'b-1' }]);
const conflict = applyCommits(conflictState, [branchB, branchA], trusted);
assert.equal(conflict.state.quarantined.length, 1, 'the unaccepted branch is quarantined');
assert.equal(conflict.state.sequence, 1, 'the accepted head is preserved for explicit repair');
assert.deepEqual(conflict.state.members, [{ principalId: 'a', deviceId: 'a-1' }]);
assert.deepEqual(conflict.state.blocked, {
  sequence: 1,
  acceptedHash: 'branch-a',
  conflictingHashes: ['branch-a', 'branch-b'],
  reason: 'conflicting-sequence',
});
assert.equal(conflict.results.at(-1)?.kind, 'quarantined');
assert.equal(applyCommit(conflict.state, commit('blocked-child', 2, 'branch-a', [{ kind: 'add', principalId: 'c', deviceId: 'c-1' }]), trusted).reason, 'conflict-blocked');

const quarantineBound = createGroupState({ groupId: 'smoke-group', authority, limits: { maxQuarantinedCommits: 1, maxQuarantinedBytes: 1 } });
const quarantineOverflow = applyCommits(quarantineBound, [branchA, branchB], trusted);
assert.equal(quarantineOverflow.results.at(-1)?.kind, 'rejected');
assert.equal(quarantineOverflow.results.at(-1)?.reason, 'quarantine-limit');
assert.equal(quarantineOverflow.state.blocked?.sequence, 1, 'retention overflow keeps the conflict block visible');

const pendingQuarantineBound = createGroupState({ groupId: 'smoke-group', authority, limits: { maxQuarantinedCommits: 1, maxQuarantinedBytes: 1 } });
const pendingDescendant = applyCommit(pendingQuarantineBound, commit('branch-descendant', 2, 'branch-b', [{ kind: 'add', principalId: 'descendant', deviceId: 'descendant-1' }]), trusted);
const acceptedWithPendingDescendant = applyCommit(pendingDescendant.state, branchA, trusted);
const overflowWithPendingDescendant = applyCommit(acceptedWithPendingDescendant.state, branchB, trusted);
assert.equal(overflowWithPendingDescendant.reason, 'quarantine-limit');
assert.equal(overflowWithPendingDescendant.state.blocked?.sequence, 1);
assert.equal(overflowWithPendingDescendant.state.pending.length, 1, 'retention overflow keeps pending evidence');

console.log('group membership smoke/model passed');
