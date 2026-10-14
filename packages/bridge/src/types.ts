/**
 * Public bridge contract.
 *
 * These types deliberately describe only Linko's local HTTP contract. They do
 * not import a DeepSeek Harness implementation, and a host can replace this
 * bridge with another client as long as it preserves these tool shapes.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface LinkoEvent extends Record<string, unknown> {
  readonly id: string;
  readonly eventId?: string;
  readonly kind?: string;
  readonly cover?: Record<string, unknown>;
  readonly parents?: readonly string[];
  readonly facts?: Record<string, unknown>;
}

/** A draft has no id until the node commits it as an immutable event. */
export type LinkoDraft = Record<string, unknown>;

export interface AskInput {
  readonly title: string;
  readonly body: string;
  readonly agentId?: string;
  readonly delegatedBy?: string;
  readonly preview?: string;
  readonly contextRefs?: readonly string[];
  readonly expiresAt?: string | null;
  readonly requiresApproval?: boolean;
  readonly targetPeerId?: string;
  readonly clientId?: string;
  readonly commandId?: string;
}

export interface ReplyInput {
  readonly eventId: string;
  readonly body: string;
  readonly title?: string;
  readonly preview?: string;
  readonly agentId?: string;
  readonly delegatedBy?: string;
  readonly contextRefs?: readonly string[];
  readonly targetPeerId?: string;
  readonly clientId?: string;
  readonly commandId?: string;
}

export interface DraftInput {
  readonly eventId: string;
  readonly body: string;
  readonly title?: string;
  readonly preview?: string;
  readonly agentId?: string;
  readonly delegatedBy?: string;
  readonly contextRefs?: readonly string[];
}

export interface InboxInput {
  readonly limit?: number;
}

export interface ApproveInput {
  readonly eventId: string;
  readonly actionId?: string;
  readonly deviceId?: string;
}

export interface BridgeResult {
  readonly event: LinkoEvent;
  readonly eventId: string;
  readonly duplicate: boolean;
  readonly delivery: string | null;
}

export interface InboxResult {
  readonly events: readonly LinkoEvent[];
}

export interface DraftResult {
  readonly draft: LinkoDraft;
  readonly parent: LinkoEvent;
}

export interface ApprovalResult {
  readonly event: LinkoEvent;
  readonly eventId: string;
  readonly state: string;
  readonly actionId: string;
}

export type BridgeToolName = "ask" | "inbox" | "inspect" | "draft" | "approve" | "reply";

export interface BridgeToolDescriptor {
  readonly name: BridgeToolName;
  readonly description: string;
  /** Human or host policy remains outside this package. */
  readonly sideEffect: "read" | "write" | "approval";
}

export interface DshBridgeHost {
  /** Register a callable tool with the host's own Agent/runtime layer. */
  registerTool(
    descriptor: BridgeToolDescriptor,
    handler: (input: unknown) => Promise<unknown>,
  ): void;
}

export interface BridgeTools {
  ask(input: AskInput): Promise<BridgeResult>;
  inbox(input?: InboxInput): Promise<InboxResult>;
  inspect(eventId: string): Promise<LinkoEvent>;
  draft(input: DraftInput): Promise<DraftResult>;
  approve(input: ApproveInput): Promise<ApprovalResult>;
  reply(input: ReplyInput): Promise<BridgeResult>;
}

export interface LinkoLocalClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}
