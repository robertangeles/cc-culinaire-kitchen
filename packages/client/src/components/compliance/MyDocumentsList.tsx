/**
 * @module components/compliance/MyDocumentsList
 *
 * A staff member's own compliance documents. Pending is the state that
 * matters most and is usually left undesigned as a bare "Pending" label —
 * here it says who has it and since when, so waiting doesn't feel like a
 * black hole. Rejected shows the reason so the staff member knows what to
 * fix without having to ask.
 *
 * Edit/delete only appear on Pending or Rejected rows — once a document is
 * Verified it's the record a manager signed off on (and the legal record
 * complianceRetentionService's 7-year window governs), so the server
 * refuses both there too. See complianceService.updateDocument /
 * deleteDocument for the full reasoning. View has no such restriction — a
 * staff member can always look at their own document, whatever its status.
 *
 * View is a read-only version of the same screen that created the entry
 * (DocumentUploadForm): the file preview plus the fields that came with it
 * (certificate number, issued, expires, issuing state) — not just the raw
 * file on its own.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, Eye, ImageOff, Loader2, Pencil, Trash2, X } from "lucide-react";
import { formatAuDate, NUDGE_ELIGIBLE_AFTER_HOURS } from "@culinaire/shared";
import { EmptyState } from "../ui/EmptyState.js";
import { StatusPill, type StatusPillVariant } from "../ui/StatusPill.js";
import { AU_STATES, inputClass } from "./documentFormShared.js";

const API = import.meta.env.VITE_API_URL ?? "";

interface MyDocument {
  complianceDocumentId: string;
  documentType: string;
  verificationStatus: string;
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingJurisdiction: string | null;
  uploadedAt: string;
  rejectionReason: string | null;
}

const STATUS_VARIANT: Record<string, StatusPillVariant> = {
  Pending: "pending",
  Verified: "compliant",
  Rejected: "rejected",
  Expired: "expired",
  "Requires Renewal": "expiring",
  Archived: "na",
  Orphaned: "na",
};

function pillAriaLabel(doc: MyDocument): string {
  const expiry = doc.expiryDate ? `, expires ${formatAuDate(doc.expiryDate)}` : "";
  return `${doc.documentType}: ${doc.verificationStatus}${expiry}`;
}

export function MyDocumentsList({ onUploadClick }: { onUploadClick?: () => void }) {
  const [documents, setDocuments] = useState<MyDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  // fetchDocuments is called both on mount and after edit/delete — the mount
  // call can still be in flight if the tab unmounts (e.g. navigating away
  // from Profile) before it resolves, so it's guarded the same way the
  // original mount-effect's `cancelled` flag was.
  const mountedRef = useRef(true);

  async function fetchDocuments() {
    try {
      const res = await fetch(`${API}/api/compliance/documents/mine`, { credentials: "include" });
      if (!res.ok) throw new Error("Couldn't load your documents.");
      const data: MyDocument[] = await res.json();
      if (!mountedRef.current) return;
      setDocuments(data);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Couldn't load your documents.");
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    fetchDocuments();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleDelete(doc: MyDocument) {
    if (!window.confirm(`Delete this ${doc.documentType}? This can't be undone.`)) return;
    setDeletingId(doc.complianceDocumentId);
    try {
      const res = await fetch(`${API}/api/compliance/documents/${doc.complianceDocumentId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't delete this document.");
      }
      await fetchDocuments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this document.");
    } finally {
      setDeletingId(null);
    }
  }

  if (error) {
    return <p className="p-4 text-sm text-red-400">{error}</p>;
  }

  if (documents === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-gold" />
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={Camera}
        title="Add your first certificate"
        body="Takes about a minute."
        action={onUploadClick ? { label: "Add a certificate", onClick: onUploadClick } : undefined}
      />
    );
  }

  return (
    <div className="animate-fade-in-up">
      <ul className="divide-y divide-dark-200 rounded-xl border border-dark-200 bg-dark-100">
        {documents.map((doc) => {
          const editable = doc.verificationStatus === "Pending" || doc.verificationStatus === "Rejected";
          const isEditing = editingId === doc.complianceDocumentId;
          const isViewing = viewingId === doc.complianceDocumentId;

          return (
            <li key={doc.complianceDocumentId} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[#FAFAFA]">{doc.documentType}</p>
                <div className="flex items-center gap-2">
                  <StatusPill variant={STATUS_VARIANT[doc.verificationStatus] ?? "na"} ariaLabel={pillAriaLabel(doc)}>
                    {doc.verificationStatus}
                  </StatusPill>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setViewingId(isViewing ? null : doc.complianceDocumentId);
                    }}
                    aria-label={`View ${doc.documentType}`}
                    aria-expanded={isViewing}
                    className={`flex size-8 items-center justify-center rounded-lg transition-colors hover:text-gold ${isViewing ? "text-gold" : "text-dark-600"}`}
                  >
                    <Eye className="size-4" aria-hidden="true" />
                  </button>
                  {editable && !isEditing && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setViewingId(null);
                          setEditingId(doc.complianceDocumentId);
                        }}
                        aria-label={`Edit ${doc.documentType}`}
                        className="flex size-8 items-center justify-center rounded-lg text-dark-600 transition-colors hover:text-gold"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(doc)}
                        disabled={deletingId === doc.complianceDocumentId}
                        aria-label={`Delete ${doc.documentType}`}
                        className="flex size-8 items-center justify-center rounded-lg text-dark-600 transition-colors hover:text-red-400 disabled:opacity-50"
                      >
                        {deletingId === doc.complianceDocumentId ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-dark-600">
                {doc.expiryDate ? `Expires ${formatAuDate(doc.expiryDate)}` : "No expiry"}
              </p>
              {doc.verificationStatus === "Pending" && (
                // uploadedAt is a `timestamp`, not a `date` column — it arrives as a
                // full ISO instant, not "YYYY-MM-DD". formatAuDate's string branch
                // assumes the latter, so it's parsed into a Date first.
                <p className="mt-2 text-xs text-gold">
                  With your manager since {formatAuDate(new Date(doc.uploadedAt))}
                </p>
              )}
              {doc.verificationStatus === "Pending" && <NudgeButton doc={doc} />}
              {doc.verificationStatus === "Rejected" && doc.rejectionReason && !isEditing && !isViewing && (
                <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
                  <p className="font-medium text-red-400">What to fix</p>
                  <p className="mt-0.5">{doc.rejectionReason}</p>
                </div>
              )}
              {isEditing && (
                <DocumentEditForm
                  doc={doc}
                  onCancel={() => setEditingId(null)}
                  onSaved={async () => {
                    setEditingId(null);
                    await fetchDocuments();
                  }}
                />
              )}
              {isViewing && <DocumentViewPanel doc={doc} onClose={() => setViewingId(null)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** CV-C7's "nudge" affordance — only renders once a Pending document has genuinely been waiting; the server re-checks the same 48h threshold, this is just so the button isn't offered before it would work. */
function NudgeButton({ doc }: { doc: MyDocument }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const hoursWaiting = (Date.now() - new Date(doc.uploadedAt).getTime()) / (60 * 60 * 1000);
  if (hoursWaiting < NUDGE_ELIGIBLE_AFTER_HOURS) return null;

  if (state === "sent") {
    return <p className="mt-1 text-xs text-dark-600">Reminder sent.</p>;
  }

  async function handleNudge() {
    setState("sending");
    setError(null);
    try {
      const res = await fetch(`${API}/api/compliance/documents/${doc.complianceDocumentId}/nudge`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't send a reminder.");
      }
      setState("sent");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn't send a reminder.");
    }
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleNudge}
        disabled={state === "sending"}
        className="text-xs text-gold underline transition-colors hover:text-gold-hover disabled:opacity-50"
      >
        {state === "sending" ? "Sending…" : "Nudge your manager"}
      </button>
      {error && <p className="mt-0.5 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function DocumentEditForm({
  doc,
  onCancel,
  onSaved,
}: {
  doc: MyDocument;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [documentNumber, setDocumentNumber] = useState(doc.documentNumber ?? "");
  const [issueDate, setIssueDate] = useState(doc.issueDate ?? "");
  const [expiryDate, setExpiryDate] = useState(doc.expiryDate ?? "");
  const [issuingJurisdiction, setIssuingJurisdiction] = useState(doc.issuingJurisdiction ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`${API}/api/compliance/documents/${doc.complianceDocumentId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentNumber: documentNumber.trim() || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          issuingJurisdiction: issuingJurisdiction || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save your changes.");
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="mt-3 flex flex-col gap-3 border-t border-dark-200 pt-3">
      <div>
        <label htmlFor={`number-${doc.complianceDocumentId}`} className="text-xs font-medium text-dark-600">
          Certificate number
        </label>
        <input
          id={`number-${doc.complianceDocumentId}`}
          type="text"
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
          maxLength={100}
          className={inputClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`issued-${doc.complianceDocumentId}`} className="text-xs font-medium text-dark-600">
            Issued
          </label>
          <input
            id={`issued-${doc.complianceDocumentId}`}
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`expires-${doc.complianceDocumentId}`} className="text-xs font-medium text-dark-600">
            Expires
          </label>
          <input
            id={`expires-${doc.complianceDocumentId}`}
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`state-${doc.complianceDocumentId}`} className="text-xs font-medium text-dark-600">
          Issuing state
        </label>
        <select
          id={`state-${doc.complianceDocumentId}`}
          value={issuingJurisdiction}
          onChange={(e) => setIssuingJurisdiction(e.target.value)}
          className={inputClass}
        >
          <option value="">Not sure / not applicable</option>
          {AU_STATES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      {saveError && <p className="text-sm text-red-400">{saveError}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 rounded-lg bg-gold px-4 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-dark-600 hover:text-[#FAFAFA]"
        >
          <X className="size-4" aria-hidden="true" />
          Cancel
        </button>
      </div>
    </form>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-dark-600">{label}</p>
      <p className="mt-0.5 text-sm text-[#E5E5E5]">{value}</p>
    </div>
  );
}

/**
 * Read-only mirror of DocumentUploadForm: the same fields it collected, plus
 * the file itself — not just the raw file on its own (see this module's
 * header comment). Fetches its own signed preview URL on mount, same as
 * VerificationView's manager-side preview.
 */
function DocumentViewPanel({ doc, onClose }: { doc: MyDocument; onClose: () => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API}/api/compliance/documents/${doc.complianceDocumentId}/view-url`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data: { url: string } = await res.json();
        if (!cancelled) setPreviewUrl(data.url);
      } catch {
        if (!cancelled) setPreviewError("Preview isn't available right now.");
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc.complianceDocumentId]);

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-dark-200 pt-3">
      <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg border border-dark-200 bg-dark">
        {previewLoading && <Loader2 className="size-6 animate-spin text-gold" />}
        {!previewLoading && previewError && (
          <div className="flex flex-col items-center gap-2 p-6 text-center text-dark-600">
            <ImageOff className="size-6" aria-hidden="true" />
            <p className="text-sm">{previewError}</p>
          </div>
        )}
        {!previewLoading && !previewError && previewUrl && (
          <iframe src={previewUrl} title={`${doc.documentType} document`} className="h-[220px] w-full" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <ReadOnlyField label="Certificate number" value={doc.documentNumber ?? "—"} />
        <ReadOnlyField label="Issuing state" value={doc.issuingJurisdiction ?? "—"} />
        <ReadOnlyField label="Issued" value={doc.issueDate ? formatAuDate(doc.issueDate) : "—"} />
        <ReadOnlyField label="Expires" value={doc.expiryDate ? formatAuDate(doc.expiryDate) : "—"} />
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-lg px-3 text-sm font-medium text-dark-600 hover:text-[#FAFAFA]"
      >
        <X className="size-4" aria-hidden="true" />
        Close
      </button>
    </div>
  );
}
