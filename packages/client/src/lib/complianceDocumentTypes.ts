/**
 * @module lib/complianceDocumentTypes
 *
 * The single canonical list of compliance document types, so every place
 * that offers one (staff upload, org-wide requirements, a role's required
 * documents) draws from the same vocabulary instead of hand-typing it.
 *
 * `compliance_document.document_type` is still free text server-side — a
 * staff member can always type something outside this list via "Other".
 * This list exists to make the COMMON case a pick, not a typo risk: the
 * compliance gate (`canAssign` server-side) matches document types by exact
 * string equality with no normalization, so "RSA" vs "R.S.A" silently fails
 * to match a real, verified, unexpired document — a dropdown for the usual
 * types removes that failure mode without removing the escape hatch for a
 * genuinely uncommon one.
 */

export const DOCUMENT_TYPES = [
  "RSA",
  "Food Safety Supervisor",
  "Working with Children Check",
  "Police Check",
  "Food Handler",
  "Visa / Work Rights",
  "Other",
];

/**
 * Same list minus "Other" — derived, not hand-duplicated, so the two can
 * never drift. "Other" is excluded here specifically: on upload it's a
 * free-text stand-in, and the form persists whatever the staff member
 * typed, never the literal string "Other" — so a document's stored type
 * can never actually equal "Other". Requiring it as an org-wide type would
 * be a requirement nobody could ever satisfy.
 */
export const REQUIRABLE_DOCUMENT_TYPES = DOCUMENT_TYPES.filter((t) => t !== "Other");
