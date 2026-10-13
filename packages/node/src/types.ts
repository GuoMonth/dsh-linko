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

export type ReceiptState = "presented" | "read" | "acknowledged" | ActionState;

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
  envelope: Envelope;
  state: EventState;
}
