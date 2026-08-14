/**
 * @module services/rosterAssignmentRules
 *
 * Pure, DB-free logic for deciding whether a staff member can be assigned to
 * a shift given the compliance documents a roster role requires. Kept
 * separate from the service that queries the DB so every rule here is
 * unit-testable in isolation — same split as complianceExpiryMath.ts.
 *
 * Formulas:
 *   F-RA-01  canAssign — per-requirement status/expiry decision
 */

export type AssignmentBlockReason = "missing" | "unverified" | "rejected" | "expired";

export type AssignmentDecision =
  | { allowed: true }
  | { allowed: false; documentType: string; reason: AssignmentBlockReason; expiryDate: string | null };

export type HeldDocument = {
  documentType: string;
  verificationStatus: string;
  /** "YYYY-MM-DD", or null if this document never expires. */
  expiryDate: string | null;
};

export type AssignmentRequirement = {
  documentType: string;
  /** document_expiry_rule.block_roster_on_expiry for this type + jurisdiction. */
  blockOnExpiry: boolean;
};

type Status = AssignmentBlockReason | "ok";

/**
 * Recomputed from expiryDate rather than trusted from a possibly stale
 * verificationStatus="Expired": the nightly scan (complianceExpiryMath) can
 * lag a document that expired between drafting and publishing a roster, and
 * a re-check at publish time needs the live answer, not the last batch run.
 */
function classify(doc: HeldDocument | undefined, today: string): Status {
  if (!doc) return "missing";
  if (doc.verificationStatus === "Rejected") return "rejected";
  if (doc.verificationStatus === "Verified") {
    return doc.expiryDate !== null && doc.expiryDate <= today ? "expired" : "ok";
  }
  return "unverified";
}

/**
 * Decide whether a staff member holding `heldDocs` can be assigned to a role
 * requiring `requirements`. Checked in order; the first requirement that
 * fails AND whose rule blocks on it stops the check. A requirement whose
 * rule does not block on expiry (blockOnExpiry=false) never gates assignment
 * — it is tracked in the compliance vault but does not stop rostering.
 */
export function canAssign(
  heldDocs: HeldDocument[],
  requirements: AssignmentRequirement[],
  today: string,
): AssignmentDecision {
  for (const req of requirements) {
    const doc = heldDocs.find((d) => d.documentType === req.documentType);
    const status = classify(doc, today);
    if (status === "ok") continue;
    if (!req.blockOnExpiry) continue;
    return { allowed: false, documentType: req.documentType, reason: status, expiryDate: doc?.expiryDate ?? null };
  }
  return { allowed: true };
}
