/**
 * @module components/compliance/MyDocumentsTab
 *
 * Composes MyDocumentsList + DocumentUploadForm into one screen for
 * compliance:read-own — neither component owns the toggle between them.
 * Switching back from the upload form remounts MyDocumentsList, which
 * re-fetches on mount, so a just-submitted certificate shows up as
 * "Pending" without a manual refresh.
 */

import { useState } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { MyDocumentsList } from "./MyDocumentsList.js";
import { DocumentUploadForm } from "./DocumentUploadForm.js";

export function MyDocumentsTab() {
  const [uploading, setUploading] = useState(false);

  if (uploading) {
    return (
      <div className="animate-fade-in-up">
        {/* DocumentUploadForm only ever calls onUploaded, never a plain
            cancel — without this, someone who taps "Add certificate" and
            changes their mind has no way back to their document list. */}
        <button
          type="button"
          onClick={() => setUploading(false)}
          className="mb-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-dark-600 transition-colors hover:text-[#FAFAFA]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to My Documents
        </button>
        <DocumentUploadForm onUploaded={() => setUploading(false)} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[#FAFAFA]">My Documents</h2>
        <button
          type="button"
          onClick={() => setUploading(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add certificate
        </button>
      </div>
      {/* No onUploadClick here: the empty-state action button would double
          up with the persistent "Add certificate" button above on a first
          visit (zero documents). One consistent place to start an upload,
          whether the list is empty or not. */}
      <MyDocumentsList />
    </div>
  );
}
