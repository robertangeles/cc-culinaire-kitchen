import type { AttentionReason, OutboxEntry, OutboxStatus, SaveLineCommand } from "./outbox";

/** One `outbox` table row. The command is JSON because each command type has its own fields. */
export interface OutboxRow {
  id: string;
  user_id: number;
  status: OutboxStatus;
  command: string;
  attempts: number;
  next_attempt_at: number;
  created_at: number;
  updated_at: number;
  attention_reason: AttentionReason | null;
  attention_message: string | null;
}

export function toRow(e: OutboxEntry): OutboxRow {
  return {
    id: e.id,
    user_id: e.userId,
    status: e.status,
    command: JSON.stringify(e.command),
    attempts: e.attempts,
    next_attempt_at: e.nextAttemptAt,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    attention_reason: e.attention?.reason ?? null,
    attention_message: e.attention?.message ?? null,
  };
}

export function fromRow(r: OutboxRow): OutboxEntry {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    command: JSON.parse(r.command) as SaveLineCommand,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(r.attention_reason ? { attention: { reason: r.attention_reason, message: r.attention_message ?? "" } } : {}),
  };
}
