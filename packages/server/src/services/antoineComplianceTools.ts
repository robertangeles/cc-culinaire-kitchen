/**
 * @module services/antoineComplianceTools
 *
 * Antoine's (the chat assistant's) compliance data tool. The model never
 * computes or infers a compliance status — it can only relay a structured
 * verdict this module resolves, matching Decision 4 of the compliance-vault
 * plan: "the system prompt instructs the model to relay verdicts verbatim
 * and never to infer or compute compliance status."
 *
 * `callerUserId` and `orgId` are NOT part of the model-facing tool schema —
 * they are the caller's own authenticated session values, injected by
 * aiService.ts the same way `buildContextString`/`recallMemoriesWithBudget`
 * already are. `orgId` in particular must be the session's verified active
 * org (aiService.ts's own `activeOrgId` doc comment: "MUST already be a
 * verified live membership"), never a value the model could supply — a tool
 * argument named "orgId" would let a session on org A ask about org B simply
 * by stating a different number.
 *
 * Every call re-derives the caller's permissions via `hasPermission`, the
 * same function `requirePermission` uses for the HTTP routes — not a copy
 * of that decision. This is the first non-HTTP caller of `hasPermission`;
 * it existed already, built for exactly this (auth.ts's own doc comment on
 * the function names "the Antoine compliance tools" as the reason it was
 * extracted).
 *
 * The verdict is deliberately narrow: `{staff, doc, status}`. No free text —
 * manager notes, rejection reasons, OCR output — ever crosses this boundary.
 * That is the safest way to satisfy "sanitize free text before it reaches a
 * prompt": data minimisation beats sanitize-and-hope. If a later change adds
 * a free-text field to the verdict, it must go through
 * `brainSanitize.ts`'s `sanitizeMemoryText` first.
 */

import { hasPermission } from "../middleware/auth.js";
import { getUserWithRolesAndPermissions } from "./authService.js";
import { listStaffCompliance, type StaffDocumentStatus } from "./complianceService.js";
import * as auditService from "./auditService.js";

export interface AntoineComplianceArgs {
  /** Model-supplied. Matched case-insensitively as a substring, same as the
   * client's own staff-table search — never an exact-match oracle that could
   * confirm or deny a near-miss name. */
  staffName: string;
  documentType: string;
}

export interface AntoineComplianceVerdict {
  found: true;
  staff: { userId: number; name: string; role: string };
  doc: { documentType: string; expiryDate: string | null };
  status: StaffDocumentStatus["status"];
}

export type AntoineComplianceResult =
  | AntoineComplianceVerdict
  | { found: false }
  | { error: "forbidden" };

/**
 * `callerUserId` and `orgId` come from the authenticated session (server
 * trusted); `args` is whatever the model supplied in the tool call
 * (untrusted, free text).
 */
export async function antoineComplianceTool(
  callerUserId: number,
  orgId: number,
  args: AntoineComplianceArgs,
): Promise<AntoineComplianceResult> {
  const caller = await getUserWithRolesAndPermissions(callerUserId);

  // listStaffCompliance is one org-wide query; there is no name-search-only
  // function to resolve staffName against, and Phase 1 orgs run at
  // restaurant-staff-list scale (tens of people), so scanning to find the
  // name match costs nothing worth a second code path. Reading this into
  // server memory before the permission check below is not itself a leak —
  // nothing is returned to the caller until the check passes, the same
  // "read internally, gate the return" shape complianceController.ts's
  // handleGetDocumentViewUrl already uses for getDocument().
  const staffRows = await listStaffCompliance(orgId);
  const query = args.staffName.trim().toLowerCase();
  const match = staffRows.find((r) => r.name.toLowerCase().includes(query));

  if (!match) {
    // No staff member resolved at all — nothing to authorise, nothing to
    // deny, and nothing worth logging: logging a lookup of a name that
    // matched nobody would itself be the oracle this function exists to
    // avoid (it would let a caller confirm which names are real staff by
    // watching what gets audited).
    return { found: false };
  }

  const isSelf = match.userId === callerUserId;
  const granted = isSelf || hasPermission(caller, "compliance:read-all", "compliance:verify");

  // Logged on BOTH outcomes, same reasoning as document_access_log's
  // granted/denied rows: a denial is the interesting row when
  // reconstructing "did someone try to ask Antoine about a colleague's
  // compliance status." audit_log, not document_access_log, because this
  // query may resolve to zero documents (a required type nobody uploaded
  // yet) — document_access_log's compliance_document_id column is NOT NULL,
  // so it cannot represent "asked about a document that doesn't exist."
  await auditService.log({
    entityType: "compliance_document",
    entityId: String(match.userId),
    action: "query",
    actorUserId: callerUserId,
    organisationId: orgId,
    metadata: {
      source: "antoine",
      outcome: granted ? "granted" : "denied",
      staffUserId: match.userId,
      documentType: args.documentType,
    },
  });

  if (!granted) return { error: "forbidden" };

  const doc = match.documents.find((d) => d.documentType === args.documentType);
  if (!doc) return { found: false };

  return {
    found: true,
    staff: { userId: match.userId, name: match.name, role: match.role },
    doc: { documentType: doc.documentType, expiryDate: doc.expiryDate },
    status: doc.status,
  };
}
