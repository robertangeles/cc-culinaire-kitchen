/**
 * @module hooks/useDocumentTypeSelection
 *
 * Shared state for a document-type picker with an "Other" free-text escape
 * hatch — used by both the staff upload form (DocumentUploadForm) and a
 * role's required-documents editor (RolesManager). Owns the selected
 * canonical type, the typed-in "Other" value, and the derived value to
 * actually persist.
 *
 * canAssign() (server-side) matches document types by exact string
 * equality with no normalization — "RSA" and "R.S.A" never match. The
 * dropdown closes that gap for the common case, but "Other" is still free
 * text, so a near-duplicate of a canonical type (different case, stray
 * dots/spaces) typed there would silently recreate the exact failure this
 * hook exists to prevent. otherTypeDuplicateOf catches that: pendingType
 * comes back empty until the near-duplicate is resolved.
 */

import { useState } from "react";
import { DOCUMENT_TYPES } from "../lib/complianceDocumentTypes.js";

const CANONICAL_TYPES = DOCUMENT_TYPES.filter((t) => t !== "Other");

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[.\s]+/g, "");
}

export function useDocumentTypeSelection(initial = "") {
  const [selectedType, setSelectedType] = useState(initial);
  const [otherType, setOtherType] = useState("");
  const trimmedOther = otherType.trim();
  const otherTypeDuplicateOf =
    selectedType === "Other" && trimmedOther
      ? (CANONICAL_TYPES.find((t) => normalize(t) === normalize(trimmedOther)) ?? null)
      : null;
  const pendingType =
    selectedType === "Other" ? (otherTypeDuplicateOf ? "" : trimmedOther) : selectedType;

  function reset() {
    setSelectedType(initial);
    setOtherType("");
  }

  return { selectedType, setSelectedType, otherType, setOtherType, pendingType, otherTypeDuplicateOf, reset };
}
