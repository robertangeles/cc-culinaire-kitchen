/**
 * @module services/auditService
 *
 * Project-wide audit trail. Every state-changing operation that needs
 * reconstructable history writes a row here.
 *
 * Receivers:
 *   - WAC reverse-recompute (catalog-spine Phase 1) reads receiving_session
 *     audit rows to know which events to exclude.
 *   - Cost drift investigation reads ingredient + ingredient_supplier rows.
 *   - Soft-delete / merge of catalog ingredients write audit rows so the
 *     menu_item_ingredient FK history is reconstructable even after the
 *     canonical row is hidden.
 *
 * Append-only by design — never UPDATE or DELETE an audit_log row from app code.
 */

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db } from "../db/index.js";
import * as schema from "../db/schema.js";
import { auditLog } from "../db/schema.js";

/** A Drizzle client OR a transaction handle. Both expose the same query API. */
export type DbOrTx = PostgresJsDatabase<typeof schema>;

export type AuditAction =
  | "create"
  | "update"
  | "cancel"
  | "complete"
  | "soft_delete"
  | "restore"
  | "merge"
  | "wac_recompute"
  | "wac_reverse"
  | "preferred_supplier_change"
  | "import_link"
  | "manual_link"
  | "manual_unlink";

export interface LogParams {
  entityType: string;
  entityId: string;
  action: AuditAction;
  /** User who initiated the action. Null for system-triggered events (cron, triggers). */
  actorUserId?: number | null;
  /** Org scope. Required for tenant-aware retrieval; only omitted for global system actions. */
  organisationId?: number | null;
  /** Pre-change row shape. Omit for create. */
  beforeValue?: Record<string, unknown> | null;
  /** Post-change row shape. Omit for delete. */
  afterValue?: Record<string, unknown> | null;
  /** Free-form context (reason, trigger source, related ids). */
  metadata?: Record<string, unknown> | null;
}

/**
 * Append a single audit_log row.
 *
 * Pass a `tx` from a surrounding `db.transaction()` so the audit row commits
 * atomically with the change being audited. If the transaction rolls back,
 * the audit row rolls back too — which is the correct behaviour: we don't
 * want audit rows for changes that didn't happen.
 *
 * If `tx` is omitted, writes against the default db pool (non-transactional).
 */
export async function log(params: LogParams, tx: DbOrTx = db): Promise<void> {
  await tx.insert(auditLog).values({
    entityType: params.entityType,
    entityId: params.entityId,
    action: params.action,
    actorUserId: params.actorUserId ?? null,
    organisationId: params.organisationId ?? null,
    beforeValue: params.beforeValue ?? null,
    afterValue: params.afterValue ?? null,
    metadata: params.metadata ?? null,
  });
}
