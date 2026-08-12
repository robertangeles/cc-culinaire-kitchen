/**
 * @module services/complianceExpiryJob
 *
 * Daily scan over `compliance_document` rows with an expiry date: flips
 * documents that have expired to `Expired`, and fires a renewal-reminder
 * notification on each configured alert day. The per-document decision
 * (expired / alert-today / nothing) is `complianceExpiryMath.computeExpiryActions`
 * — this module's job is only to fetch what that function needs, act on its
 * answer, and notify without double-sending.
 *
 * JURISDICTION. The rule lookup uses the VENUE's state
 * (`compliance_document.store_location_id` -> `store_location.state`), never
 * `issuing_jurisdiction` — see the schema comment on `complianceDocument` for
 * why. `state` is free text (no dropdown), so `jurisdictionFromState` below
 * normalises common full names as well as abbreviations, mirroring the same
 * mapping `applyComplianceSchema.ts` uses to backfill `iana_timezone`.
 *
 * COMMIT PER ROW, ON PURPOSE. The whole scan is never wrapped in a
 * transaction: a failure at row 3 of 200 must not roll back rows 1 and 2,
 * and `hasRecentNotification` (backed by `idx_notification_entity`) makes a
 * retry of the same day safe on its own — see dailyRunClaim.ts for the same
 * reasoning applied to the once-a-day claim one level up.
 *
 * EMAIL BODIES ARE ESCAPED. Staff display names come from registration and
 * `trainingProviderUrl` is free text on a rule, so both are attacker-controlled
 * by the time they reach a manager's mail client. Everything interpolated goes
 * through `escapeHtml`, and the renewal link is rejected unless it is plain
 * http(s) — a `javascript:` href is click-to-execute in several webmail clients.
 */

import { eq, and, ne, or, isNull, isNotNull, lte, gte } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import {
  complianceDocument,
  documentExpiryRule,
  documentExpiryRuleAlertDay,
  storeLocation,
  user,
} from "../db/schema.js";
import { dayKey } from "../utils/dailyRunClaim.js";
import { escapeHtml, safeHttpUrl } from "../utils/escapeHtml.js";
import { computeExpiryActions, type ExpiryAction } from "./complianceExpiryMath.js";
import {
  createInApp,
  notifyHQAdmins,
  hasRecentNotification,
  type NotificationType,
} from "./notificationService.js";
import { formatAuDate } from "@culinaire/shared";

const logger = pino({ name: "complianceExpiryJob" });

const ENTITY_TYPE = "compliance_document";

const EXPIRY_ALERT_TYPE: NotificationType = "DOCUMENT_EXPIRY_ALERT";

/**
 * `store_location.state` free text -> `document_expiry_rule.jurisdiction` code.
 * Mirrors the CASE mapping `applyComplianceSchema.ts` uses to backfill
 * `iana_timezone` — same 8 AU states/territories, same reasoning: the state
 * field has no dropdown, so both abbreviation and full name are accepted.
 */
const JURISDICTION_BY_STATE: Record<string, string> = {
  NSW: "NSW",
  "NEW SOUTH WALES": "NSW",
  ACT: "ACT",
  "AUSTRALIAN CAPITAL TERRITORY": "ACT",
  TAS: "TAS",
  TASMANIA: "TAS",
  QLD: "QLD",
  QUEENSLAND: "QLD",
  SA: "SA",
  "SOUTH AUSTRALIA": "SA",
  WA: "WA",
  "WESTERN AUSTRALIA": "WA",
  NT: "NT",
  "NORTHERN TERRITORY": "NT",
  VIC: "VIC",
  VICTORIA: "VIC",
};

function jurisdictionFromState(state: string | null): string | null {
  if (!state) return null;
  return JURISDICTION_BY_STATE[state.trim().toUpperCase()] ?? null;
}

interface CandidateDoc {
  complianceDocumentId: string;
  organisationId: number;
  userId: number | null;
  documentType: string;
  expiryDate: string | null;
  verificationStatus: string;
  staffName: string | null;
  venueState: string | null;
  venueName: string | null;
}

const CANDIDATE_COLUMNS = {
  complianceDocumentId: complianceDocument.complianceDocumentId,
  organisationId: complianceDocument.organisationId,
  userId: complianceDocument.userId,
  documentType: complianceDocument.documentType,
  expiryDate: complianceDocument.expiryDate,
  verificationStatus: complianceDocument.verificationStatus,
  staffName: user.userName,
  venueState: storeLocation.state,
  venueName: storeLocation.locationName,
};

/** compliance_document rows a scan should even look at: has an expiry date, not dead. */
async function selectCandidates(): Promise<CandidateDoc[]> {
  return db
    .select(CANDIDATE_COLUMNS)
    .from(complianceDocument)
    .leftJoin(user, eq(complianceDocument.userId, user.userId))
    .leftJoin(storeLocation, eq(complianceDocument.storeLocationId, storeLocation.storeLocationId))
    .where(
      and(
        isNotNull(complianceDocument.expiryDate),
        ne(complianceDocument.verificationStatus, "Archived"),
      ),
    );
}

interface Rule {
  alertDays: number[];
  effectiveFrom: string;
  effectiveTo: string | null;
  trainingProviderUrl: string | null;
}

/**
 * The rule in force today for this document type + venue jurisdiction,
 * falling back to the national rule (jurisdiction IS NULL) when no
 * venue-specific one is active. Both candidates are fetched in one query;
 * the venue-specific row wins when both are active for today.
 */
async function loadRule(
  documentType: string,
  jurisdiction: string | null,
  today: string,
): Promise<Rule | null> {
  const jurisdictionFilter = jurisdiction
    ? or(eq(documentExpiryRule.jurisdiction, jurisdiction), isNull(documentExpiryRule.jurisdiction))
    : isNull(documentExpiryRule.jurisdiction);

  const rows = await db
    .select({
      documentExpiryRuleId: documentExpiryRule.documentExpiryRuleId,
      jurisdiction: documentExpiryRule.jurisdiction,
      effectiveFrom: documentExpiryRule.effectiveFrom,
      effectiveTo: documentExpiryRule.effectiveTo,
      trainingProviderUrl: documentExpiryRule.trainingProviderUrl,
    })
    .from(documentExpiryRule)
    .where(
      and(
        eq(documentExpiryRule.documentType, documentType),
        jurisdictionFilter,
        lte(documentExpiryRule.effectiveFrom, today),
        or(isNull(documentExpiryRule.effectiveTo), gte(documentExpiryRule.effectiveTo, today)),
      ),
    );

  const picked = rows.find((r) => r.jurisdiction !== null) ?? rows.find((r) => r.jurisdiction === null);
  if (!picked) return null;

  const alertDayRows = await db
    .select({ daysBefore: documentExpiryRuleAlertDay.daysBefore })
    .from(documentExpiryRuleAlertDay)
    .where(eq(documentExpiryRuleAlertDay.documentExpiryRuleId, picked.documentExpiryRuleId));

  return {
    alertDays: alertDayRows.map((r) => r.daysBefore),
    effectiveFrom: picked.effectiveFrom,
    effectiveTo: picked.effectiveTo,
    trainingProviderUrl: picked.trainingProviderUrl,
  };
}

/** Notify the document's staff member (if any) plus the org's HQ admins. */
async function sendExpiryAlert(
  doc: CandidateDoc,
  rule: Rule,
  action: Extract<ExpiryAction, { kind: "alert" }>,
): Promise<void> {
  const expiryFormatted = formatAuDate(doc.expiryDate as string);
  const subjectLabel = doc.userId !== null ? (doc.staffName ?? "Unknown staff") : (doc.venueName ?? "Unknown venue");

  const payload: Record<string, unknown> = {
    complianceDocumentId: doc.complianceDocumentId,
    documentType: doc.documentType,
    expiryDate: expiryFormatted,
    daysRemaining: action.daysRemaining,
    ...(doc.userId !== null ? { staffName: subjectLabel } : { venueName: subjectLabel }),
    ...(rule.trainingProviderUrl ? { trainingProviderUrl: rule.trainingProviderUrl } : {}),
  };

  if (doc.userId !== null) {
    await createInApp({
      organisationId: doc.organisationId,
      recipientUserId: doc.userId,
      type: EXPIRY_ALERT_TYPE,
      payload,
      relatedEntityType: ENTITY_TYPE,
      relatedEntityId: doc.complianceDocumentId,
    });
  }

  const daysLabel = action.daysRemaining === 1 ? "1 day" : `${action.daysRemaining} days`;

  // Every value below reaches a manager's HTML email client, and two of them are
  // attacker-controlled: `staffName` is whatever a user typed at registration,
  // and `trainingProviderUrl` is free-text on a rule. Interpolating either raw
  // is stored HTML injection — a display name of `<img src=x onerror=...>`, or a
  // `javascript:` href that is click-to-execute in several webmail clients.
  const safeTrainingUrl = safeHttpUrl(rule.trainingProviderUrl);
  const trainingLine = safeTrainingUrl
    ? `<p><strong>Renew here:</strong> <a href="${escapeHtml(safeTrainingUrl)}">${escapeHtml(safeTrainingUrl)}</a></p>`
    : "";

  await notifyHQAdmins(
    doc.organisationId,
    EXPIRY_ALERT_TYPE,
    payload,
    ENTITY_TYPE,
    doc.complianceDocumentId,
    // Subject line is plain text, so it is not escaped — but it must never carry
    // markup either, in case a client renders it richly.
    `Compliance document expiring: ${doc.documentType} for ${subjectLabel} (${daysLabel})`,
    `
      <h2 style="color: #d97706; margin-bottom: 16px;">Compliance Document Expiring</h2>
      <p><strong>Staff / venue:</strong> ${escapeHtml(subjectLabel)}</p>
      <p><strong>Document type:</strong> ${escapeHtml(doc.documentType)}</p>
      <p><strong>Expires:</strong> ${escapeHtml(expiryFormatted)}</p>
      <p><strong>Days remaining:</strong> ${action.daysRemaining}</p>
      ${trainingLine}
    `,
    // Compliance expiry is owned by whoever verifies documents, NOT by whoever
    // approves purchase orders (this helper's default). Without this argument
    // the alert reaches the wrong people and the right people never hear about
    // an expiring certificate.
    "compliance:verify",
  );
}

/**
 * Run the daily expiry scan. Injectable `today` ("YYYY-MM-DD") so tests are
 * deterministic; production callers default to the current local day.
 */
export async function runExpiryScan(
  today: string = dayKey(new Date()),
): Promise<{ scanned: number; notified: number; expired: number }> {
  const candidates = await selectCandidates();

  let scanned = 0;
  let notified = 0;
  let expired = 0;

  for (const doc of candidates) {
    const expiryDate = doc.expiryDate;
    if (expiryDate === null) continue; // belt-and-suspenders — the SQL filter above already excludes these
    scanned++;

    try {
      const jurisdiction = jurisdictionFromState(doc.venueState);
      const rule = await loadRule(doc.documentType, jurisdiction, today);
      const actions = computeExpiryActions(
        { expiryDate, verificationStatus: doc.verificationStatus },
        rule,
        today,
      );

      for (const action of actions) {
        if (action.kind === "expired") {
          await db
            .update(complianceDocument)
            .set({ verificationStatus: "Expired", updatedDttm: new Date() })
            .where(eq(complianceDocument.complianceDocumentId, doc.complianceDocumentId));
          expired++;
        } else if (action.kind === "alert") {
          const alreadyNotified = await hasRecentNotification(
            ENTITY_TYPE,
            doc.complianceDocumentId,
            EXPIRY_ALERT_TYPE,
            24,
          );
          if (alreadyNotified) continue;

          await sendExpiryAlert(doc, rule as Rule, action);
          notified++;
        }
      }
    } catch (err) {
      logger.error(
        { err, complianceDocumentId: doc.complianceDocumentId },
        "Compliance expiry scan failed for document",
      );
    }
  }

  return { scanned, notified, expired };
}
