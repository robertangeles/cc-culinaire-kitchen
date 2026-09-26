/**
 * @module services/complianceExpiryService
 *
 * Global expiry-rule management — jurisdiction law library, not org-scoped.
 * `document_expiry_rule` (+ `document_expiry_rule_alert_day` junction) carries
 * NO organisation_id: an RSA renewal cadence in VIC is the same law for every org,
 * effective-dated and versioned per the schema's own doc comment.
 *
 * See complianceService.ts (barrel) for the full module doc.
 */

import { eq, and, isNull, sql, asc, desc, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { documentExpiryRule, documentExpiryRuleAlertDay } from "../db/schema.js";
import * as auditService from "./auditService.js";
import { withRetryOnConflict } from "../utils/retryOnConflict.js";
import { ComplianceError } from "./complianceErrors.js";

export interface ExpiryRuleInput {
  documentType: string;
  jurisdiction?: string | null;
  validityPeriodYears?: number | null;
  blockRosterOnExpiry?: boolean;
  trainingProviderUrl?: string | null;
  effectiveFrom: string;
  sourceCitation?: string | null;
  notes?: string | null;
  alertDays?: number[];
}

/** Every rule, current and historical, oldest-effective last within each type+jurisdiction. */
export async function listExpiryRules() {
  const rules = await db
    .select()
    .from(documentExpiryRule)
    .orderBy(
      asc(documentExpiryRule.documentType),
      asc(documentExpiryRule.jurisdiction),
      desc(documentExpiryRule.effectiveFrom),
    );
  if (rules.length === 0) return [];

  const alertRows = await db
    .select()
    .from(documentExpiryRuleAlertDay)
    .where(
      inArray(
        documentExpiryRuleAlertDay.documentExpiryRuleId,
        rules.map((r) => r.documentExpiryRuleId),
      ),
    );
  const alertsByRule = new Map<string, number[]>();
  for (const row of alertRows) {
    const list = alertsByRule.get(row.documentExpiryRuleId) ?? [];
    list.push(row.daysBefore);
    alertsByRule.set(row.documentExpiryRuleId, list);
  }

  return rules.map((r) => ({
    ...r,
    alertDays: (alertsByRule.get(r.documentExpiryRuleId) ?? []).sort((a, b) => b - a),
  }));
}

/**
 * Create a new rule version for (documentType, jurisdiction), closing out the
 * currently-active version so a roster published under the old rule can still
 * see the rule that applied AT THE TIME (schema doc comment).
 *
 * Same-day-edit guard: if the computed close date (`effectiveFrom - 1 day`)
 * would fall before the currently-active row's OWN `effectiveFrom`, this
 * rejects instead of writing an inverted range on the row being closed —
 * editing the same rule twice in one day is the case that trips this.
 *
 * Race-safe: `idx_document_expiry_rule_one_active` (a partial unique index
 * on (documentType, coalesce(jurisdiction,'')) WHERE effective_to IS NULL)
 * is the DB-level backstop — two concurrent creates for the same key can
 * each close the row they see, but only one INSERT wins; the loser's 23505
 * is caught by `withRetryOnConflict` and the whole attempt retried once, so
 * it re-reads the now-closed state and completes cleanly instead of
 * surfacing a raw constraint-violation error to the caller.
 */
export async function upsertExpiryRule(input: ExpiryRuleInput, actorUserId: number) {
  const documentType = input.documentType.trim();
  if (!documentType) throw new ComplianceError("Document type is required", 400);
  if (!input.effectiveFrom) throw new ComplianceError("An effective-from date is required", 400);
  const jurisdiction = input.jurisdiction?.trim() || null;

  return withRetryOnConflict(() => upsertExpiryRuleAttempt(documentType, jurisdiction, input, actorUserId));
}

async function upsertExpiryRuleAttempt(
  documentType: string,
  jurisdiction: string | null,
  input: ExpiryRuleInput,
  actorUserId: number,
) {
  return db.transaction(async (tx) => {
    const activeMatch = jurisdiction
      ? and(
          eq(documentExpiryRule.documentType, documentType),
          eq(documentExpiryRule.jurisdiction, jurisdiction),
        )
      : and(
          eq(documentExpiryRule.documentType, documentType),
          isNull(documentExpiryRule.jurisdiction),
        );

    const [activeRow] = await tx
      .select({
        documentExpiryRuleId: documentExpiryRule.documentExpiryRuleId,
        effectiveFrom: documentExpiryRule.effectiveFrom,
      })
      .from(documentExpiryRule)
      .where(and(activeMatch, isNull(documentExpiryRule.effectiveTo)));

    if (activeRow && input.effectiveFrom <= activeRow.effectiveFrom) {
      throw new ComplianceError(
        "This rule was already updated today — edit the existing row directly instead of creating a new version",
        409,
      );
    }

    if (activeRow) {
      await tx
        .update(documentExpiryRule)
        .set({
          effectiveTo: sql`(${input.effectiveFrom}::date - 1)`,
          updatedDttm: new Date(),
        })
        .where(and(activeMatch, isNull(documentExpiryRule.effectiveTo)));

      await auditService.log(
        {
          entityType: "document_expiry_rule",
          entityId: activeRow.documentExpiryRuleId,
          action: "update",
          actorUserId,
          metadata: { closedBy: "auto-supersede" },
        },
        tx,
      );
    }

    const [created] = await tx
      .insert(documentExpiryRule)
      .values({
        documentType,
        jurisdiction,
        validityPeriodYears: input.validityPeriodYears ?? null,
        blockRosterOnExpiry: input.blockRosterOnExpiry ?? false,
        trainingProviderUrl: input.trainingProviderUrl ?? null,
        effectiveFrom: input.effectiveFrom,
        sourceCitation: input.sourceCitation ?? null,
        notes: input.notes ?? null,
      })
      .returning();

    const alertDays = [...new Set(input.alertDays ?? [])];
    if (alertDays.length > 0) {
      await tx
        .insert(documentExpiryRuleAlertDay)
        .values(
          alertDays.map((daysBefore) => ({
            documentExpiryRuleId: created.documentExpiryRuleId,
            daysBefore,
          })),
        );
    }

    await auditService.log(
      {
        entityType: "document_expiry_rule",
        entityId: created.documentExpiryRuleId,
        action: "create",
        actorUserId,
        afterValue: { ...created, alertDays },
      },
      tx,
    );

    return { ...created, alertDays: alertDays.sort((a, b) => b - a) };
  });
}
