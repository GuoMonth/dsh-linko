import type { ActionState, Envelope } from "./types.js";

export type ActionDecision = "approved" | "rejected";

export interface ActionBinding {
  eventDigest: string;
  actionId: string;
  audience: string | null;
  authority: string | null;
  policyVersion: string | null;
  deviceId: string;
}

export interface ActionAttempt {
  status: ActionState;
  binding: ActionBinding;
}

export interface ActionDecisionInput {
  eventDigest: string;
  envelope: Envelope;
  actionId: string;
  decision: ActionDecision;
  deviceId: string;
  at: string;
  previous: ActionAttempt | null;
}

export type ActionDecisionResult =
  | { ok: true; duplicate: boolean; status: ActionDecision; binding: ActionBinding }
  | { ok: false; code: string; message: string };

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 32) throw new Error("identity value is too deep");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("identity value is not finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonical(entry, depth + 1)).join(",")}]`;
  if (typeof value === "object") {
    const object = value as JsonRecord;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key], depth + 1)}`).join(",")}}`;
  }
  throw new Error("identity value is unsupported");
}

function identityValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try { return canonical(value); } catch { return null; }
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function strictTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const hour = Number(match[4]); const minute = Number(match[5]); const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]); const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const maxDay = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > maxDay || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Extract the identity dimensions that the current node can persist. Missing
 * protocol fields remain null and are documented as deferred until signed
 * audience/authority policy is implemented.
 */
export function actionBinding(envelope: Envelope, eventDigest: string, actionId: string, deviceId: string): ActionBinding {
  const policy = record(envelope.policy);
  const seal = record(envelope.seal);
  const cover = record(envelope.cover);
  const actor = firstDefined(envelope.authority, policy?.authority, seal?.authority, envelope.actor, cover?.actor);
  const audience = firstDefined(envelope.audience, policy?.audience, seal?.audience);
  const policyVersion = firstDefined(envelope.policyVersion, policy?.policyVersion, policy?.version);
  return {
    eventDigest,
    actionId,
    audience: identityValue(audience),
    authority: identityValue(actor),
    policyVersion: identityValue(policyVersion),
    deviceId,
  };
}

function availableActions(envelope: Envelope): string[] {
  const semantic = record(envelope.semantic);
  if (!Array.isArray(semantic?.availableActions)) return [];
  return semantic.availableActions.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function expiry(envelope: Envelope): { value: string | null; timestamp: number | null; error?: string } {
  const policy = record(envelope.policy);
  const value = policy?.expiresAt;
  if (value === undefined || value === null) return { value: null, timestamp: null };
  if (typeof value !== "string" || value.length === 0) return { value: null, timestamp: null, error: "policy expiresAt must be an ISO timestamp or null" };
  const timestamp = strictTimestamp(value);
  return timestamp === null ? { value: null, timestamp: null, error: "policy expiresAt must be an ISO timestamp or null" } : { value, timestamp };
}

function sameBinding(left: ActionBinding, right: ActionBinding): boolean {
  return left.eventDigest === right.eventDigest
    && left.actionId === right.actionId
    && left.audience === right.audience
    && left.authority === right.authority
    && left.policyVersion === right.policyVersion
    && left.deviceId === right.deviceId;
}

/**
 * Pure approval/rejection boundary. It does not execute anything and has no
 * clock or storage side effects; callers provide the evaluation instant.
 */
export function reduceActionDecision(input: ActionDecisionInput): ActionDecisionResult {
  const policy = record(input.envelope.policy);
  const requiresApproval = policy?.requiresApproval === true;
  const actions = availableActions(input.envelope);
  if (!actions.includes(input.actionId)) return { ok: false, code: "ACTION_NOT_REQUESTED", message: "action is not requested by this envelope" };

  const expiration = expiry(input.envelope);
  if (expiration.error) return { ok: false, code: "POLICY_INVALID_EXPIRY", message: expiration.error };
  const evaluatedAt = strictTimestamp(input.at);
  if (evaluatedAt === null) return { ok: false, code: "INVALID_INPUT", message: "decision timestamp is invalid" };
  if (input.decision === "approved" && !requiresApproval) return { ok: false, code: "APPROVAL_NOT_REQUIRED", message: "approval requires policy.requiresApproval=true" };
  if (input.decision === "approved" && expiration.timestamp !== null && evaluatedAt >= expiration.timestamp) {
    return { ok: false, code: "APPROVAL_EXPIRED", message: "the envelope approval window has expired" };
  }

  const binding = actionBinding(input.envelope, input.eventDigest, input.actionId, input.deviceId);
  if (input.previous !== null) {
    const previous = input.previous.status;
    if (previous !== "requested" && previous !== "awaiting_approval") {
      if (previous === input.decision && sameBinding(input.previous.binding, binding)) {
        return { ok: true, duplicate: true, status: input.decision, binding };
      }
      if (previous === "approved" || previous === "rejected") {
        if (input.previous.binding.eventDigest !== binding.eventDigest
          || input.previous.binding.actionId !== binding.actionId
          || input.previous.binding.audience !== binding.audience
          || input.previous.binding.authority !== binding.authority
          || input.previous.binding.policyVersion !== binding.policyVersion
          || input.previous.binding.deviceId !== binding.deviceId) {
          return { ok: false, code: "ACTION_IDENTITY_MISMATCH", message: "action decision identity does not match the original attempt" };
        }
        return { ok: false, code: "INVALID_TRANSITION", message: `action ${input.actionId} cannot move from ${previous} to ${input.decision}` };
      }
      return { ok: false, code: "INVALID_TRANSITION", message: `action ${input.actionId} cannot move from ${previous} to ${input.decision}` };
    }
    // Rows created before optional identity columns existed remain bound to
    // the immutable event/action pair; newly persisted dimensions constrain
    // the transition when they are present.
    const stored = input.previous.binding;
    if (stored.eventDigest !== binding.eventDigest || stored.actionId !== binding.actionId
      || (stored.audience !== null && stored.audience !== binding.audience)
      || (stored.authority !== null && stored.authority !== binding.authority)
      || (stored.policyVersion !== null && stored.policyVersion !== binding.policyVersion)
      || (stored.deviceId !== "" && stored.deviceId !== binding.deviceId)) {
      return { ok: false, code: "ACTION_IDENTITY_MISMATCH", message: "action decision identity does not match the requested action" };
    }
  }
  return { ok: true, duplicate: false, status: input.decision, binding };
}
