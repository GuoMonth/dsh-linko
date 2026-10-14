/**
 * Experimental deterministic group membership reducer for Linko's planned
 * 500-principal profile. The reducer has no crypto, storage, or transport dependency.
 */

export const MAX_ACTIVE_PRINCIPALS = 500 as const;
export const DEFAULT_MAX_PENDING_COMMITS = 1024 as const;
export const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_QUARANTINED_COMMITS = 1024 as const;
export const DEFAULT_MAX_QUARANTINED_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_OPERATIONS_PER_COMMIT = 256 as const;
export const DEFAULT_MAX_COMMIT_BYTES = 64 * 1024;

export interface SignerIdentity {
  readonly principalId: string;
  readonly deviceId: string;
}

export interface GroupMember extends SignerIdentity {}

export interface AddMemberOperation {
  readonly kind: "add";
  readonly principalId: string;
  readonly deviceId: string;
}

export interface RemoveMemberOperation {
  readonly kind: "remove";
  readonly principalId: string;
  /** If provided, the active device must match this value. */
  readonly deviceId?: string;
}

export interface ReplaceMemberOperation {
  readonly kind: "replace";
  readonly principalId: string;
  readonly oldDeviceId: string;
  readonly newDeviceId: string;
}

export type MembershipOperation = AddMemberOperation | RemoveMemberOperation | ReplaceMemberOperation;

/**
 * A signed-version-shaped input. `commitHash` is supplied by the caller and
 * must be checked against the canonical unsigned bytes by the injected
 * verifier. This package intentionally does not implement cryptography.
 */
export interface SignedMembershipCommit {
  readonly groupId: string;
  readonly sequence: number;
  readonly parentHash: string | null;
  readonly commitHash: string;
  readonly signer: SignerIdentity;
  readonly operations: readonly MembershipOperation[];
  readonly signature: string;
}

export interface AcceptedMembershipCommit {
  readonly commit: SignedMembershipCommit;
}

export type PendingReason = "missing-parent" | "signer-unavailable";

export interface PendingMembershipCommit {
  readonly commit: SignedMembershipCommit;
  readonly reason: PendingReason;
}

export type QuarantineReason =
  | "conflicting-sequence"
  | "conflicting-parent"
  | "conflicting-hash"
  | "descendant-of-quarantine";

export interface MembershipBlock {
  /** The first sequence at which two authority histories diverged. */
  readonly sequence: number;
  /** The accepted branch remains the visible head until an explicit repair. */
  readonly acceptedHash: string | null;
  /** Hashes that caused or extended this block, kept for operator review. */
  readonly conflictingHashes: readonly string[];
  readonly reason: QuarantineReason;
}

export interface QuarantinedMembershipCommit {
  readonly commit: SignedMembershipCommit;
  readonly reason: QuarantineReason;
  readonly conflictingHash?: string;
}

export interface RetentionLimits {
  readonly maxPendingCommits: number;
  readonly maxPendingBytes: number;
  readonly maxQuarantinedCommits: number;
  readonly maxQuarantinedBytes: number;
  readonly maxOperationsPerCommit: number;
  readonly maxCommitBytes: number;
}

export interface GroupState {
  readonly groupId: string;
  readonly maxPrincipals: number;
  readonly authority: SignerIdentity;
  /** The sequence of the active chain head. The empty state is sequence 0. */
  readonly sequence: number;
  readonly headHash: string | null;
  readonly initialMembers: readonly GroupMember[];
  readonly members: readonly GroupMember[];
  readonly accepted: readonly AcceptedMembershipCommit[];
  readonly pending: readonly PendingMembershipCommit[];
  readonly quarantined: readonly QuarantinedMembershipCommit[];
  /** A conflict stops new membership advancement until an explicit repair. */
  readonly blocked: MembershipBlock | null;
  readonly limits: RetentionLimits;
}

export type VerificationStatus = "verified" | "invalid" | "unavailable";

export interface CommitVerificationInput {
  readonly commit: SignedMembershipCommit;
  readonly unsignedBytes: Uint8Array;
  readonly expectedSigner: SignerIdentity;
  readonly state: GroupState;
}

export interface CommitVerification {
  readonly status: VerificationStatus;
  readonly reason?: string;
}

export type CommitVerifier = (input: CommitVerificationInput) => CommitVerification | VerificationStatus;

export interface GroupReducerOptions {
  /** Required for acceptance; inject real signature and hash checking here. */
  readonly verifyCommit?: CommitVerifier;
}

export type CommitResultKind = "applied" | "duplicate" | "pending" | "quarantined" | "rejected";

export type CommitResultReason =
  | PendingReason
  | QuarantineReason
  | "malformed"
  | "wrong-group"
  | "invalid-signature"
  | "verification-unavailable"
  | "unauthorized-signer"
  | "broken-parent-chain"
  | "invalid-transition"
  | "over-cap"
  | "operation-limit"
  | "commit-too-large"
  | "pending-limit"
  | "quarantine-limit"
  | "conflict-blocked";

export interface CommitResult {
  /** `kind` is the programmatic discriminator; `status` is an observable alias. */
  readonly kind: CommitResultKind;
  readonly status: CommitResultKind;
  readonly commitHash: string;
  readonly state: GroupState;
  readonly reason?: CommitResultReason;
  readonly conflictingHash?: string;
  /** Includes a commit and any pending descendants released by this call. */
  readonly advanced: readonly string[];
}

export interface BatchResult {
  readonly state: GroupState;
  readonly results: readonly CommitResult[];
}

export interface CreateGroupStateOptions {
  readonly groupId: string;
  readonly authority: SignerIdentity;
  readonly initialMembers?: readonly GroupMember[];
  /** Test profiles may choose a lower bound; values above 500 are rejected. */
  readonly maxPrincipals?: number;
  readonly limits?: Partial<RetentionLimits>;
}

type CanonicalOperation =
  | { readonly kind: "add"; readonly principalId: string; readonly deviceId: string }
  | { readonly kind: "remove"; readonly principalId: string; readonly deviceId?: string }
  | { readonly kind: "replace"; readonly principalId: string; readonly oldDeviceId: string; readonly newDeviceId: string };

const DEFAULT_VERIFICATION: CommitVerification = { status: "invalid", reason: "verifier-required" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 256;
}

function validHash(value: unknown): value is string {
  return validIdentifier(value);
}

function sameIdentity(left: SignerIdentity, right: SignerIdentity): boolean {
  return left.principalId === right.principalId && left.deviceId === right.deviceId;
}

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareMembers(left: GroupMember, right: GroupMember): number {
  return ordinal(left.principalId, right.principalId) || ordinal(left.deviceId, right.deviceId);
}

function compareCommits(left: SignedMembershipCommit, right: SignedMembershipCommit): number {
  return left.sequence - right.sequence || ordinal(left.commitHash, right.commitHash) || ordinal(commitFingerprint(left), commitFingerprint(right));
}

function copyIdentity(value: SignerIdentity): SignerIdentity {
  return { principalId: value.principalId, deviceId: value.deviceId };
}

function copyOperation(operation: CanonicalOperation): MembershipOperation {
  if (operation.kind === "add") return { kind: "add", principalId: operation.principalId, deviceId: operation.deviceId };
  if (operation.kind === "remove") {
    return operation.deviceId === undefined
      ? { kind: "remove", principalId: operation.principalId }
      : { kind: "remove", principalId: operation.principalId, deviceId: operation.deviceId };
  }
  return {
    kind: "replace",
    principalId: operation.principalId,
    oldDeviceId: operation.oldDeviceId,
    newDeviceId: operation.newDeviceId,
  };
}

function copyCommit(commit: SignedMembershipCommit): SignedMembershipCommit {
  return {
    groupId: commit.groupId,
    sequence: commit.sequence,
    parentHash: commit.parentHash,
    commitHash: commit.commitHash,
    signer: copyIdentity(commit.signer),
    operations: commit.operations.map((operation) => copyOperation(normalizeOperation(operation)!)),
    signature: commit.signature,
  };
}

function normalizeOperation(value: unknown): CanonicalOperation | null {
  if (!isRecord(value)) return null;
  const kind = value.kind ?? value.type;
  if (kind === "add" && validIdentifier(value.principalId) && validIdentifier(value.deviceId)) {
    return { kind: "add", principalId: value.principalId, deviceId: value.deviceId };
  }
  if (kind === "remove" && validIdentifier(value.principalId)) {
    if (value.deviceId !== undefined && !validIdentifier(value.deviceId)) return null;
    return {
      kind: "remove",
      principalId: value.principalId,
      ...(value.deviceId === undefined ? {} : { deviceId: value.deviceId }),
    };
  }
  if (kind === "replace" && validIdentifier(value.principalId)) {
    const oldDeviceId = value.oldDeviceId ?? value.previousDeviceId;
    const newDeviceId = value.newDeviceId ?? value.deviceId;
    if (!validIdentifier(oldDeviceId) || !validIdentifier(newDeviceId)) return null;
    return { kind: "replace", principalId: value.principalId, oldDeviceId, newDeviceId };
  }
  return null;
}

function normalizeCommit(value: unknown): SignedMembershipCommit | null {
  if (!isRecord(value) || !validIdentifier(value.groupId) || !Number.isSafeInteger(value.sequence)) return null;
  const sequence = value.sequence;
  if (typeof sequence !== "number" || sequence < 1) return null;
  if (!(value.parentHash === null || validHash(value.parentHash)) || !validHash(value.commitHash) || !validIdentifier(value.signature)) return null;
  if ((sequence === 1) !== (value.parentHash === null)) return null;
  if (!isRecord(value.signer) || !validIdentifier(value.signer.principalId) || !validIdentifier(value.signer.deviceId)) return null;
  if (!Array.isArray(value.operations)) return null;
  const operations = value.operations.map(normalizeOperation);
  if (operations.some((operation): operation is null => operation === null)) return null;
  return {
    groupId: value.groupId,
    sequence,
    parentHash: value.parentHash,
    commitHash: value.commitHash,
    signer: { principalId: value.signer.principalId, deviceId: value.signer.deviceId },
    operations: operations.map((operation) => copyOperation(operation!)),
    signature: value.signature,
  };
}

/** Canonical JSON bytes that a verifier should authenticate. */
export function canonicalUnsignedCommit(commit: SignedMembershipCommit): string {
  const normalized = normalizeCommit(commit);
  if (normalized === null) throw new TypeError("malformed membership commit");
  return JSON.stringify({
    groupId: normalized.groupId,
    sequence: normalized.sequence,
    parentHash: normalized.parentHash,
    signer: normalized.signer,
    operations: normalized.operations,
  });
}

/** UTF-8 bytes of the canonical unsigned representation for crypto adapters. */
export function canonicalUnsignedCommitBytes(commit: SignedMembershipCommit): Uint8Array {
  return new TextEncoder().encode(canonicalUnsignedCommit(commit));
}

function commitFingerprint(commit: SignedMembershipCommit): string {
  return `${canonicalUnsignedCommit(commit)}\u0000${commit.signature}`;
}

function commitBytes(commit: SignedMembershipCommit): number {
  return new TextEncoder().encode(commitFingerprint(commit)).byteLength;
}

function sortMembers(members: readonly GroupMember[]): GroupMember[] {
  return members.map(copyIdentity).sort(compareMembers);
}

function sortAccepted(accepted: readonly AcceptedMembershipCommit[]): AcceptedMembershipCommit[] {
  return accepted.map((record) => ({ commit: copyCommit(record.commit) })).sort((left, right) => compareCommits(left.commit, right.commit));
}

function sortPending(pending: readonly PendingMembershipCommit[]): PendingMembershipCommit[] {
  return pending
    .map((record) => ({ commit: copyCommit(record.commit), reason: record.reason }))
    .sort((left, right) => compareCommits(left.commit, right.commit) || ordinal(left.reason, right.reason));
}

function sortQuarantined(quarantined: readonly QuarantinedMembershipCommit[]): QuarantinedMembershipCommit[] {
  return quarantined
    .map((record) => ({
      commit: copyCommit(record.commit),
      reason: record.reason,
      ...(record.conflictingHash === undefined ? {} : { conflictingHash: record.conflictingHash }),
    }))
    .sort((left, right) => compareCommits(left.commit, right.commit) || ordinal(left.reason, right.reason));
}

function copyLimits(limits: RetentionLimits): RetentionLimits {
  return { ...limits };
}

function copyBlock(block: MembershipBlock | null | undefined): MembershipBlock | null {
  return block === null || block === undefined
    ? null
    : {
        sequence: block.sequence,
        acceptedHash: block.acceptedHash,
        conflictingHashes: [...new Set(block.conflictingHashes)].sort(ordinal),
        reason: block.reason,
      };
}

function copyState(state: GroupState): GroupState {
  return {
    groupId: state.groupId,
    maxPrincipals: state.maxPrincipals,
    authority: copyIdentity(state.authority),
    sequence: state.sequence,
    headHash: state.headHash,
    initialMembers: sortMembers(state.initialMembers),
    members: sortMembers(state.members),
    accepted: sortAccepted(state.accepted),
    pending: sortPending(state.pending),
    quarantined: sortQuarantined(state.quarantined),
    blocked: copyBlock(state.blocked),
    limits: copyLimits(state.limits),
  };
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new RangeError(`${label} must be a positive integer`);
  return resolved;
}

function makeLimits(input: Partial<RetentionLimits> | undefined): RetentionLimits {
  return {
    maxPendingCommits: positiveLimit(input?.maxPendingCommits, DEFAULT_MAX_PENDING_COMMITS, "maxPendingCommits"),
    maxPendingBytes: positiveLimit(input?.maxPendingBytes, DEFAULT_MAX_PENDING_BYTES, "maxPendingBytes"),
    maxQuarantinedCommits: positiveLimit(input?.maxQuarantinedCommits, DEFAULT_MAX_QUARANTINED_COMMITS, "maxQuarantinedCommits"),
    maxQuarantinedBytes: positiveLimit(input?.maxQuarantinedBytes, DEFAULT_MAX_QUARANTINED_BYTES, "maxQuarantinedBytes"),
    maxOperationsPerCommit: positiveLimit(input?.maxOperationsPerCommit, DEFAULT_MAX_OPERATIONS_PER_COMMIT, "maxOperationsPerCommit"),
    maxCommitBytes: positiveLimit(input?.maxCommitBytes, DEFAULT_MAX_COMMIT_BYTES, "maxCommitBytes"),
  };
}

export function createGroupState(options: CreateGroupStateOptions): GroupState {
  if (!validIdentifier(options.groupId)) throw new TypeError("groupId must be a non-empty identifier");
  if (!validIdentifier(options.authority?.principalId) || !validIdentifier(options.authority?.deviceId)) {
    throw new TypeError("authority must contain principalId and deviceId");
  }
  const maxPrincipals = options.maxPrincipals ?? MAX_ACTIVE_PRINCIPALS;
  if (!Number.isSafeInteger(maxPrincipals) || maxPrincipals < 1 || maxPrincipals > MAX_ACTIVE_PRINCIPALS) {
    throw new RangeError(`maxPrincipals must be between 1 and ${MAX_ACTIVE_PRINCIPALS}`);
  }
  const limits = makeLimits(options.limits);
  const members = options.initialMembers ?? [];
  const normalized = members.map((member) => {
    if (!validIdentifier(member?.principalId) || !validIdentifier(member?.deviceId)) throw new TypeError("initial member is malformed");
    return { principalId: member.principalId, deviceId: member.deviceId };
  });
  const principals = new Set<string>();
  for (const member of normalized) {
    if (principals.has(member.principalId)) throw new TypeError("initial members must have one device per principal");
    if (member.principalId === options.authority.principalId) throw new TypeError("authority is separate from the active roster in this profile");
    principals.add(member.principalId);
  }
  if (normalized.length > maxPrincipals) throw new RangeError("initial members exceed the active-principal cap");
  const initialMembers = sortMembers(normalized);
  return {
    groupId: options.groupId,
    maxPrincipals,
    authority: copyIdentity(options.authority),
    sequence: 0,
    headHash: null,
    initialMembers,
    members: sortMembers(initialMembers),
    accepted: [],
    pending: [],
    quarantined: [],
    blocked: null,
    limits,
  };
}

function makeResult(
  kind: CommitResultKind,
  commitHash: string,
  state: GroupState,
  reason: CommitResultReason | undefined,
  advanced: readonly string[],
  conflictingHash?: string,
): CommitResult {
  return {
    kind,
    status: kind,
    commitHash,
    state: copyState(state),
    ...(reason === undefined ? {} : { reason }),
    ...(conflictingHash === undefined ? {} : { conflictingHash }),
    advanced: [...advanced],
  };
}

function pendingBytes(pending: readonly PendingMembershipCommit[]): number {
  return pending.reduce((total, record) => total + commitBytes(record.commit), 0);
}

function quarantinedBytes(quarantined: readonly QuarantinedMembershipCommit[]): number {
  return quarantined.reduce((total, record) => total + commitBytes(record.commit), 0);
}

function withPending(state: GroupState, commit: SignedMembershipCommit, reason: PendingReason): GroupState | null {
  const fingerprint = commitFingerprint(commit);
  const existing = state.pending.some((record) => commitFingerprint(record.commit) === fingerprint);
  const pending = state.pending.filter((record) => commitFingerprint(record.commit) !== fingerprint);
  if (!existing && (pending.length >= state.limits.maxPendingCommits || pendingBytes(pending) + commitBytes(commit) > state.limits.maxPendingBytes)) return null;
  pending.push({ commit: copyCommit(commit), reason });
  return { ...copyState(state), pending: sortPending(pending) };
}

function withQuarantine(state: GroupState, records: readonly QuarantinedMembershipCommit[]): GroupState | null {
  const merged = [...state.quarantined];
  for (const record of records) {
    const fingerprint = commitFingerprint(record.commit);
    if (!merged.some((existing) => commitFingerprint(existing.commit) === fingerprint)) merged.push({
      commit: copyCommit(record.commit),
      reason: record.reason,
      ...(record.conflictingHash === undefined ? {} : { conflictingHash: record.conflictingHash }),
    });
  }
  const uniqueBytes = quarantinedBytes(merged);
  if (merged.length > state.limits.maxQuarantinedCommits || uniqueBytes > state.limits.maxQuarantinedBytes) return null;
  return { ...copyState(state), quarantined: sortQuarantined(merged) };
}

function acceptedWithHash(state: GroupState, hash: string): AcceptedMembershipCommit | undefined {
  return state.accepted.find((record) => record.commit.commitHash === hash);
}

function quarantineWithHash(state: GroupState, hash: string): QuarantinedMembershipCommit | undefined {
  return state.quarantined.find((record) => record.commit.commitHash === hash);
}

function transitionMembers(
  state: GroupState,
  operations: readonly MembershipOperation[],
): { members: GroupMember[]; reason?: "invalid-transition" | "over-cap" } {
  const members = new Map(state.members.map((member) => [member.principalId, copyIdentity(member)]));
  for (const input of operations) {
    const operation = normalizeOperation(input);
    if (operation === null) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
    const current = members.get(operation.principalId);
    if (operation.kind === "add") {
      if (operation.principalId === state.authority.principalId) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
      if (current !== undefined) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
      members.set(operation.principalId, { principalId: operation.principalId, deviceId: operation.deviceId });
      continue;
    }
    if (current === undefined) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
    if (sameIdentity(current, state.authority)) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
    if (operation.kind === "remove") {
      if (operation.deviceId !== undefined && operation.deviceId !== current.deviceId) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
      members.delete(operation.principalId);
      continue;
    }
    if (operation.oldDeviceId !== current.deviceId || operation.newDeviceId === current.deviceId) return { members: sortMembers([...members.values()]), reason: "invalid-transition" };
    members.set(operation.principalId, { principalId: operation.principalId, deviceId: operation.newDeviceId });
  }
  if (members.size > state.maxPrincipals) return { members: sortMembers([...members.values()]), reason: "over-cap" };
  return { members: sortMembers([...members.values()]) };
}

function verifierResult(options: GroupReducerOptions, commit: SignedMembershipCommit, state: GroupState): CommitVerification {
  if (options.verifyCommit === undefined) return DEFAULT_VERIFICATION;
  try {
    const result = options.verifyCommit({
      commit: copyCommit(commit),
      unsignedBytes: canonicalUnsignedCommitBytes(commit),
      expectedSigner: copyIdentity(state.authority),
      state: copyState(state),
    });
    if (typeof result === "string") return result === "verified" || result === "invalid" || result === "unavailable" ? { status: result } : { status: "invalid", reason: "unknown-verifier-result" };
    return result.status === "verified" || result.status === "invalid" || result.status === "unavailable" ? result : { status: "invalid", reason: "unknown-verifier-result" };
  } catch {
    return { status: "invalid", reason: "verifier-error" };
  }
}

function rebuildMembers(state: GroupState, accepted: readonly AcceptedMembershipCommit[]): GroupMember[] {
  let members = sortMembers(state.initialMembers);
  for (const record of sortAccepted(accepted)) {
    const transition = transitionMembers({ ...state, members }, record.commit.operations);
    if (transition.reason !== undefined) throw new Error("accepted history cannot be rebuilt");
    members = transition.members;
  }
  return members;
}

/**
 * Preserve the accepted head, quarantine the unaccepted branch, and expose an
 * explicit block. A conflict must never silently rewrite an already accepted
 * membership projection; repair is a separate operation outside this kernel.
 */
function blockConflict(
  state: GroupState,
  incoming: SignedMembershipCommit,
  conflictSequence: number,
  reason: QuarantineReason,
  conflictingHash?: string,
): GroupState {
  const pendingDescendants = state.pending.filter((record) => record.commit.sequence >= conflictSequence);
  const records: QuarantinedMembershipCommit[] = [
    ...pendingDescendants.map((record) => ({ commit: record.commit, reason: "descendant-of-quarantine" as const, conflictingHash: incoming.commitHash })),
    { commit: incoming, reason, ...(conflictingHash === undefined ? {} : { conflictingHash }) },
  ];
  const acceptedAtConflict = state.accepted.find((record) => record.commit.sequence === conflictSequence);
  const blocked: MembershipBlock = {
    sequence: conflictSequence,
    acceptedHash: acceptedAtConflict?.commit.commitHash ?? state.headHash,
    conflictingHashes: [
      ...(conflictingHash === undefined ? [] : [conflictingHash]),
      incoming.commitHash,
      ...pendingDescendants.map((record) => record.commit.commitHash),
    ],
    reason,
  };
  const preserved: GroupState = {
    ...state,
    pending: state.pending.filter((record) => record.commit.sequence < conflictSequence),
    blocked,
  };
  // A retention limit must not erase the safety state. If evidence cannot fit,
  // keep the explicit block and return a rejected result to the caller.
  return withQuarantine(preserved, records) ?? { ...preserved, pending: state.pending };
}

function conflictResult(
  state: GroupState,
  commit: SignedMembershipCommit,
  conflictSequence: number,
  reason: QuarantineReason,
  conflictingHash?: string,
): CommitResult {
  const next = blockConflict(state, commit, conflictSequence, reason, conflictingHash);
  const retained = next.quarantined.some((record) => commitFingerprint(record.commit) === commitFingerprint(commit));
  return retained
    ? makeResult("quarantined", commit.commitHash, next, reason, [], conflictingHash)
    : makeResult("rejected", commit.commitHash, next, "quarantine-limit", []);
}

function pendingResult(state: GroupState, commit: SignedMembershipCommit, reason: PendingReason): CommitResult {
  const next = withPending(state, commit, reason);
  return next === null
    ? makeResult("rejected", commit.commitHash, state, "pending-limit", [])
    : makeResult("pending", commit.commitHash, next, reason, []);
}

function quarantineResult(
  state: GroupState,
  commitHash: string,
  next: GroupState | null,
  reason: QuarantineReason,
  conflictingHash?: string,
): CommitResult {
  return next === null
    ? makeResult("rejected", commitHash, state, "quarantine-limit", [])
    : makeResult("quarantined", commitHash, next, reason, [], conflictingHash);
}

function coreApply(stateInput: GroupState, input: SignedMembershipCommit, options: GroupReducerOptions): CommitResult {
  const state = copyState(stateInput);
  const commit = normalizeCommit(input);
  const suppliedHash = isRecord(input) && typeof input.commitHash === "string" ? input.commitHash : "";
  if (commit === null) return makeResult("rejected", suppliedHash, state, "malformed", []);
  const commitHash = commit.commitHash;
  if (commit.groupId !== state.groupId) return makeResult("rejected", commitHash, state, "wrong-group", []);
  if (!sameIdentity(commit.signer, state.authority)) return makeResult("rejected", commitHash, state, "unauthorized-signer", []);
  if (commit.operations.length > state.limits.maxOperationsPerCommit) return makeResult("rejected", commitHash, state, "operation-limit", []);
  if (commitBytes(commit) > state.limits.maxCommitBytes) return makeResult("rejected", commitHash, state, "commit-too-large", []);

  // Verify before trusting any duplicate or conflict claim.
  const verification = verifierResult(options, commit, state);
  if (verification.status === "unavailable") return pendingResult(state, commit, "signer-unavailable");
  if (verification.status !== "verified") return makeResult("rejected", commitHash, state, "invalid-signature", []);

  const existingAccepted = acceptedWithHash(state, commitHash);
  const existingQuarantine = quarantineWithHash(state, commitHash);
  const pendingVariants = state.pending.filter((record) => record.commit.commitHash === commitHash);
  const existingPending = pendingVariants[0];
  if (existingAccepted !== undefined) {
    const same = commitFingerprint(existingAccepted.commit) === commitFingerprint(commit);
    if (same) return makeResult("duplicate", commitHash, state, undefined, []);
    return conflictResult(state, commit, existingAccepted.commit.sequence, "conflicting-hash", existingAccepted.commit.commitHash);
  }
  if (existingQuarantine !== undefined) {
    const same = commitFingerprint(existingQuarantine.commit) === commitFingerprint(commit);
    if (same) return makeResult("quarantined", commitHash, state, existingQuarantine.reason, [], existingQuarantine.conflictingHash);
    return quarantineResult(state, commitHash, withQuarantine(state, [{ commit, reason: "conflicting-hash", conflictingHash: existingQuarantine.commit.commitHash }]), "conflicting-hash", existingQuarantine.commit.commitHash);
  }
  if (state.blocked !== null) return makeResult("rejected", commitHash, state, "conflict-blocked", []);
  const collidingPending = pendingVariants.filter((record) => commitFingerprint(record.commit) !== commitFingerprint(commit));
  if (collidingPending.length > 0) {
    const withoutCollidingPending: GroupState = {
      ...state,
      pending: state.pending.filter((record) => record.commit.commitHash !== commitHash),
    };
    const records: QuarantinedMembershipCommit[] = [
      ...pendingVariants.map((record) => ({ commit: record.commit, reason: "conflicting-hash" as const, conflictingHash: commitHash })),
      { commit, reason: "conflicting-hash", conflictingHash: commitHash },
    ];
    return quarantineResult(withoutCollidingPending, commitHash, withQuarantine(withoutCollidingPending, records), "conflicting-hash", commitHash);
  }
  const withoutPending: GroupState = existingPending === undefined
    ? state
    : { ...state, pending: state.pending.filter((record) => record.commit.commitHash !== commitHash) };

  const sameSequence = withoutPending.accepted.find((record) => record.commit.sequence === commit.sequence);
  if (sameSequence !== undefined && sameSequence.commit.commitHash !== commitHash) {
    return conflictResult(withoutPending, commit, commit.sequence, "conflicting-sequence", sameSequence.commit.commitHash);
  }
  const sameQuarantineSequence = withoutPending.quarantined.find((record) => record.commit.sequence === commit.sequence && record.commit.commitHash !== commitHash);
  if (sameQuarantineSequence !== undefined) {
    return quarantineResult(withoutPending, commitHash, withQuarantine(withoutPending, [{ commit, reason: "conflicting-sequence", conflictingHash: sameQuarantineSequence.commit.commitHash }]), "conflicting-sequence", sameQuarantineSequence.commit.commitHash);
  }

  const expectedParent = withoutPending.sequence === 0 ? null : withoutPending.headHash;
  if (commit.sequence > withoutPending.sequence + 1) return pendingResult(withoutPending, commit, "missing-parent");
  if (commit.sequence <= withoutPending.sequence) {
    const parentConflict = commit.parentHash !== expectedParent;
    return conflictResult(withoutPending, commit, commit.sequence, parentConflict ? "conflicting-parent" : "conflicting-sequence", withoutPending.headHash ?? undefined);
  }
  if (commit.sequence > 1 && commit.parentHash === null) return makeResult("rejected", commitHash, withoutPending, "broken-parent-chain", []);
  if (commit.parentHash !== expectedParent) {
    const knownParent = commit.parentHash === null ? undefined : acceptedWithHash(withoutPending, commit.parentHash);
    const quarantinedParent = commit.parentHash === null ? undefined : quarantineWithHash(withoutPending, commit.parentHash);
    if (quarantinedParent !== undefined) return quarantineResult(withoutPending, commitHash, withQuarantine(withoutPending, [{ commit, reason: "descendant-of-quarantine", conflictingHash: commit.parentHash! }]), "descendant-of-quarantine", commit.parentHash!);
    if (knownParent !== undefined) {
      return conflictResult(withoutPending, commit, knownParent.commit.sequence + 1, "conflicting-parent", commit.parentHash!);
    }
    return pendingResult(withoutPending, commit, "missing-parent");
  }

  const transition = transitionMembers(withoutPending, commit.operations);
  if (transition.reason !== undefined) return makeResult("rejected", commitHash, withoutPending, transition.reason, []);
  const accepted = [...withoutPending.accepted, { commit: copyCommit(commit) }];
  const next: GroupState = {
    ...withoutPending,
    sequence: commit.sequence,
    headHash: commit.commitHash,
    members: sortMembers(transition.members),
    accepted: sortAccepted(accepted),
    pending: withoutPending.pending.filter((record) => record.commit.commitHash !== commitHash),
  };
  return makeResult("applied", commitHash, next, undefined, [commitHash]);
}

function drainPending(stateInput: GroupState, options: GroupReducerOptions): { state: GroupState; advanced: string[] } {
  let state = copyState(stateInput);
  const advanced: string[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pending of [...state.pending].sort((left, right) => compareCommits(left.commit, right.commit))) {
      const before = state;
      const result = coreApply(state, pending.commit, options);
      state = result.state;
      if (result.kind === "applied") {
        advanced.push(...result.advanced);
        changed = true;
      } else if (result.kind === "rejected" || result.kind === "quarantined") {
        changed = changed || before.pending.length !== state.pending.length || before.quarantined.length !== state.quarantined.length;
      }
    }
  }
  return { state, advanced };
}

/** Apply one commit and release any now-contiguous pending descendants. */
export function applyCommit(stateInput: GroupState, commit: SignedMembershipCommit, options: GroupReducerOptions = {}): CommitResult {
  const first = coreApply(stateInput, commit, options);
  const drained = drainPending(first.state, options);
  const advanced = [...new Set([...first.advanced, ...drained.advanced])];
  const finalState = drained.state;
  const incomingAccepted = finalState.accepted.some((record) => record.commit.commitHash === first.commitHash);
  const kind = first.kind === "pending" && incomingAccepted ? "applied" : first.kind;
  const reason = kind === "applied" ? undefined : first.reason;
  return makeResult(kind, first.commitHash, finalState, reason, advanced, first.conflictingHash);
}

/**
 * Apply a set in sequence/hash order. Sorting makes replay independent of
 * arrival order; parent gaps are held pending and released as the chain fills.
 */
export function applyCommits(stateInput: GroupState, commits: readonly SignedMembershipCommit[], options: GroupReducerOptions = {}): BatchResult {
  let state = copyState(stateInput);
  const results: CommitResult[] = [];
  const ordered = [...commits].sort((left, right) => {
    const leftNormalized = normalizeCommit(left);
    const rightNormalized = normalizeCommit(right);
    if (leftNormalized === null || rightNormalized === null) return ordinal(String(leftNormalized?.commitHash ?? ""), String(rightNormalized?.commitHash ?? ""));
    return compareCommits(leftNormalized, rightNormalized);
  });
  for (const commit of ordered) {
    const result = applyCommit(state, commit, options);
    results.push(result);
    state = result.state;
  }
  return { state, results };
}
