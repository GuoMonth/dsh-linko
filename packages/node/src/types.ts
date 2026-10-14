export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type Envelope = Record<string, unknown> & {
  id: string;
};

export type ActionState =
  | "requested"
  | "awaiting_approval"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "uncertain"
  | "rejected"
  | "expired";

/** States that the local UI may record through POST /v1/receipts. */
export type ReceiptState = "presented" | "read" | "acknowledged" | "approved" | "rejected";

export interface EventState {
  delivered: boolean;
  deliveredAt: string;
  presentedAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  devices: Array<{ deviceId: string; presentation: "unseen" | "presented" | "read" }>;
  actions: Record<string, { status: ActionState; updatedAt: string }>;
}

export interface SyncItem {
  id: string;
  eventId: string;
  cursor: number;
  originPeerId: string | null;
  envelope: Envelope;
  state: EventState;
}

export interface PeerConfig {
  peerId: string;
  label: string;
  endpoint: string;
  certSha256: string;
  bearerSecret: string;
}

export interface OutboxItem {
  eventId: string;
  peerId: string;
  status: "queued" | "sending" | "confirmed" | "retry_wait" | "rejected" | "abandoned";
  attempts: number;
  nextAttemptAt: string | null;
  lastError?: string;
}
