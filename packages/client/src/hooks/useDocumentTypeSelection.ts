/**
 * @module hooks/useDocumentTypeSelection
 *
 * Shared state for a document-type picker with an "Other" free-text escape
 * hatch — used by both the staff upload form (DocumentUploadForm) and a
 * role's required-documents editor (RolesManager). Owns the selected
 * canonical type, the typed-in "Other" value, and the derived value to
 * actually persist.
 */

import { useState } from "react";

export function useDocumentTypeSelection(initial = "") {
  const [selectedType, setSelectedType] = useState(initial);
  const [otherType, setOtherType] = useState("");
  const pendingType = selectedType === "Other" ? otherType.trim() : selectedType;

  function reset() {
    setSelectedType(initial);
    setOtherType("");
  }

  return { selectedType, setSelectedType, otherType, setOtherType, pendingType, reset };
}
