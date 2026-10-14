import { LinkoLocalClient } from "./client.js";
import type {
  ApproveInput,
  AskInput,
  BridgeResult,
  BridgeToolDescriptor,
  BridgeTools,
  DraftInput,
  DraftResult,
  DshBridgeHost,
  InboxInput,
  InboxResult,
  LinkoDraft,
  LinkoEvent,
  ReplyInput,
} from "./types.js";

const DEFAULT_AGENT_ID = "agent:linko-bridge";
const MAX_TEXT = 32_000;

export const TOOL_DESCRIPTORS: readonly BridgeToolDescriptor[] = [
  { name: "ask", description: "Create an Agent collaboration request in the local Linko node.", sideEffect: "write" },
  { name: "inbox", description: "List events in the local Linko inbox.", sideEffect: "read" },
  { name: "inspect", description: "Read one event and its projected delivery/action facts.", sideEffect: "read" },
  { name: "draft", description: "Prepare an uncommitted reply draft for one inbox event.", sideEffect: "read" },
  { name: "approve", description: "Record a human-approved action for one inbox event.", sideEffect: "approval" },
  { name: "reply", description: "Commit a reply envelope for one inbox event.", sideEffect: "write" },
];

function inputObject(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${context} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, required = true): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT) throw new TypeError(`${field} must be non-empty text of at most ${MAX_TEXT} characters`);
  return value;
}

function strings(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 512)) throw new TypeError(`${field} must be an array of non-empty strings`);
  return value as string[];
}

function eventId(value: unknown): string {
  return text(value, "eventId") as string;
}

function agentActor(agentId: string, delegatedBy: string | undefined): Record<string, unknown> {
  return delegatedBy === undefined
    ? { kind: "agent-autonomous", id: agentId }
    : { kind: "agent-delegated", id: agentId, composerId: agentId, delegatorId: delegatedBy };
}

function previewFor(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length <= 160 ? compact : `${compact.slice(0, 157)}...`;
}

function titleFrom(event: LinkoEvent): string {
  const cover = event.cover;
  return cover !== undefined && typeof cover.title === "string" && cover.title.length > 0 ? cover.title : "Linko request";
}

function askEnvelope(input: AskInput): Record<string, unknown> {
  const title = text(input.title, "title") as string;
  const body = text(input.body, "body") as string;
  const agentId = text(input.agentId, "agentId", false) ?? DEFAULT_AGENT_ID;
  const delegatedBy = text(input.delegatedBy, "delegatedBy", false);
  const requiresApproval = input.requiresApproval ?? true;
  if (typeof requiresApproval !== "boolean") throw new TypeError("requiresApproval must be a boolean");
  const contextRefs = strings(input.contextRefs, "contextRefs");
  const expiresAt = input.expiresAt === undefined ? null : input.expiresAt;
  if (expiresAt !== null && typeof expiresAt !== "string") throw new TypeError("expiresAt must be an ISO string or null");
  return {
    kind: "collaboration.request",
    cover: {
      title,
      preview: text(input.preview, "preview", false) ?? previewFor(body),
      actor: agentActor(agentId, delegatedBy),
      status: requiresApproval ? "needs-human-approval" : "informational",
    },
    semantic: { intent: "request", contextRefs, availableActions: requiresApproval ? ["approve", "reject", "inspect"] : ["inspect"] },
    policy: { risk: requiresApproval ? "medium" : "low", requiresApproval, expiresAt },
    inlineBody: body,
  };
}

function replyDraft(input: DraftInput, parent: LinkoEvent): LinkoDraft {
  const body = text(input.body, "body") as string;
  const agentId = text(input.agentId, "agentId", false) ?? DEFAULT_AGENT_ID;
  const delegatedBy = text(input.delegatedBy, "delegatedBy", false);
  const contextRefs = strings(input.contextRefs, "contextRefs");
  const title = text(input.title, "title", false) ?? `Re: ${titleFrom(parent)}`;
  return {
    kind: "collaboration.reply",
    parents: [eventId(input.eventId)],
    quote: { eventId: input.eventId, title: titleFrom(parent) },
    cover: {
      title,
      preview: text(input.preview, "preview", false) ?? previewFor(body),
      actor: agentActor(agentId, delegatedBy),
      status: "informational",
    },
    semantic: { intent: "inform", contextRefs, availableActions: ["inspect"] },
    policy: { risk: "low", requiresApproval: false, expiresAt: null },
    inlineBody: body,
  };
}

/**
 * Small, replaceable companion bridge. It owns translation between host tool
 * calls and the Linko local API; it does not own an Agent, an approval policy,
 * a peer connection, or an LLM.
 */
export class DshCompanionBridge implements BridgeTools {
  constructor(readonly client: LinkoLocalClient) {}

  async ask(input: AskInput): Promise<BridgeResult> {
    const value = inputObject(input, "ask input") as unknown as AskInput;
    return this.client.createEnvelope(askEnvelope(value), {
      targetPeerId: text(value.targetPeerId, "targetPeerId", false),
      clientId: text(value.clientId, "clientId", false),
      commandId: text(value.commandId, "commandId", false),
    });
  }

  async inbox(input: InboxInput = {}): Promise<InboxResult> {
    const value = inputObject(input, "inbox input") as InboxInput;
    if (value.limit !== undefined && (!Number.isInteger(value.limit) || value.limit < 1)) throw new TypeError("limit must be a positive integer");
    return this.client.inbox(value.limit);
  }

  async inspect(value: string): Promise<LinkoEvent> {
    return this.client.inspect(eventId(value));
  }

  async draft(input: DraftInput): Promise<DraftResult> {
    const value = inputObject(input, "draft input") as unknown as DraftInput;
    const id = eventId(value.eventId);
    const parent = await this.client.inspect(id);
    return { draft: replyDraft({ ...value, eventId: id }, parent), parent };
  }

  async approve(input: ApproveInput) {
    const value = inputObject(input, "approve input") as unknown as ApproveInput;
    const id = eventId(value.eventId);
    return this.client.approve(id, text(value.actionId, "actionId", false), text(value.deviceId, "deviceId", false));
  }

  async reply(input: ReplyInput): Promise<BridgeResult> {
    const value = inputObject(input, "reply input") as unknown as ReplyInput;
    const id = eventId(value.eventId);
    const drafted = await this.draft({
      eventId: id,
      body: value.body,
      title: value.title,
      preview: value.preview,
      agentId: value.agentId,
      delegatedBy: value.delegatedBy,
      contextRefs: value.contextRefs,
    });
    return this.client.createEnvelope(drafted.draft, {
      targetPeerId: text(value.targetPeerId, "targetPeerId", false),
      clientId: text(value.clientId, "clientId", false),
      commandId: text(value.commandId, "commandId", false),
    });
  }

  /** Register the six stable tool names into any compatible host. */
  register(host: DshBridgeHost): void {
    const handlers: Record<string, (input: unknown) => Promise<unknown>> = {
      ask: (input) => this.ask(input as AskInput),
      inbox: (input) => this.inbox(input === undefined ? {} : input as InboxInput),
      inspect: (input) => this.inspect(typeof input === "string" ? input : eventId(inputObject(input, "inspect input").eventId)),
      draft: (input) => this.draft(input as DraftInput),
      approve: (input) => this.approve(input as ApproveInput),
      reply: (input) => this.reply(input as ReplyInput),
    };
    for (const descriptor of TOOL_DESCRIPTORS) host.registerTool(descriptor, handlers[descriptor.name]);
  }
}

export function createDshCompanionBridge(options: { readonly client?: LinkoLocalClient; readonly baseUrl?: string } = {}): DshCompanionBridge {
  return new DshCompanionBridge(options.client ?? new LinkoLocalClient(options.baseUrl));
}
