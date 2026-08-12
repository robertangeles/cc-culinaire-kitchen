/**
 * @module components/compliance/VerificationView
 *
 * The HQ verification queue. This is the screen where an uploaded certificate
 * becomes trustworthy data or a rubber stamp — if a manager approves without
 * looking, every compliance number downstream is fiction.
 *
 * The anti-rubber-stamp mechanism: fields the upload's OCR pass pre-filled
 * carry a gold dot + "read from photo" caption, so the manager knows exactly
 * which values were machine-read (and deserve a second look) versus typed by
 * the staff member.
 *
 * BACKEND GAP (flagged, not fixed here — out of this component's file
 * ownership): two endpoints this view depends on are not wired in
 * routes/compliance.ts yet:
 *   - GET /api/compliance/documents/:id/view-url — should call
 *     documentStorageService.signedUrlForDocument() and return { url }.
 *   - The `ocrFilledFields` used below is not returned by
 *     complianceService.listDocumentsForOrg (compliance_document has no
 *     column recording which fields OCR filled). Every read of it falls
 *     back to an empty set, so the screen still works — it just shows no
 *     gold dots — until that's added.
 * Both calls degrade gracefully (loading/empty states) rather than crashing.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, ImageOff } from "lucide-react";
import { formatAuDate } from "@culinaire/shared";
import { EmptyState } from "../ui/EmptyState.js";

const API = import.meta.env.VITE_API_URL ?? "";

interface QueueDocument {
  complianceDocumentId: string;
  documentType: string;
  engagementType: "employee" | "contractor" | "agency";
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingJurisdiction: string | null;
  staffName: string | null;
  uploadedAt: string;
  /** See BACKEND GAP above — currently always undefined. */
  ocrFilledFields?: string[];
}

const ENGAGEMENT_LABEL: Record<string, string> = {
  employee: "Employee",
  contractor: "Contractor",
  agency: "Agency staff",
};

function OcrMark() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-1.5 rounded-full bg-gold" aria-hidden="true" />
      <span className="text-[10px] font-normal text-gold">read from photo</span>
    </span>
  );
}

function Field({ label, value, ocr }: { label: string; value: string; ocr: boolean }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-medium text-dark-600">
        {label}
        {ocr && <OcrMark />}
      </p>
      <p className="mt-0.5 text-sm text-[#E5E5E5]">{value}</p>
    </div>
  );
}

export function VerificationView({ onQueueChange }: { onQueueChange?: (remaining: number) => void }) {
  const [documents, setDocuments] = useState<QueueDocument[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionGuard = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/compliance/pending`, { credentials: "include" });
        if (!res.ok) throw new Error("Couldn't load the verification queue.");
        const data: QueueDocument[] = await res.json();
        if (cancelled) return;
        setDocuments(data);
        setTotal(data.length);
        onQueueChange?.(data.length);
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Couldn't load the verification queue.");
          setDocuments([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on mount — the queue is fetched fresh, not re-fetched when
    // onQueueChange identity changes.
  }, []);

  const current = documents && documents.length > 0 ? documents[0] : null;

  useEffect(() => {
    if (!current) {
      setImageUrl(null);
      return;
    }
    let cancelled = false;
    setImageUrl(null);
    setImageError(null);
    setImageLoading(true);
    (async () => {
      try {
        const res = await fetch(`${API}/api/compliance/documents/${current.complianceDocumentId}/view-url`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setImageUrl(data.url);
      } catch {
        if (!cancelled) setImageError("Preview isn't available right now.");
      } finally {
        if (!cancelled) setImageLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.complianceDocumentId]);

  async function resolveCurrent(action: "verify" | "reject", reason?: string) {
    if (!current || actionGuard.current) return;
    actionGuard.current = true;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(`${API}/api/compliance/documents/${current.complianceDocumentId}/${action}`, {
        method: "POST",
        credentials: "include",
        headers: reason !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: reason !== undefined ? JSON.stringify({ reason }) : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "That didn't go through. Try again.");
      }
      setDocuments((prev) => {
        const next = (prev ?? []).slice(1);
        onQueueChange?.(next.length);
        return next;
      });
      setRejecting(false);
      setRejectReason("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setActionLoading(false);
      actionGuard.current = false;
    }
  }

  if (loadError) {
    return <p className="p-6 text-sm text-red-400">{loadError}</p>;
  }

  if (documents === null) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-gold" />
      </div>
    );
  }

  if (!current) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="All caught up"
        body="No documents are waiting for review right now."
        variant="invitation"
      />
    );
  }

  const position = total - documents.length + 1;
  const progressPct = total > 0 ? ((total - documents.length) / total) * 100 : 0;
  const filled = new Set(current.ocrFilledFields ?? []);

  return (
    <div className="animate-fade-in-up">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold text-[#FAFAFA]">Verify documents</h2>
        <div className="text-right">
          <p className="text-xs text-dark-600">
            {position} of {total} pending
          </p>
          <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-dark-200">
            <div
              className="h-full rounded-full bg-gold transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl border border-dark-200 bg-dark-100 lg:min-h-[520px] lg:w-[55%]">
          {imageLoading && <Loader2 className="size-6 animate-spin text-gold" />}
          {!imageLoading && imageError && (
            <div className="flex flex-col items-center gap-2 p-6 text-center text-dark-600">
              <ImageOff className="size-8" aria-hidden="true" />
              <p className="text-sm">{imageError}</p>
            </div>
          )}
          {!imageLoading && !imageError && imageUrl && (
            <iframe
              src={imageUrl}
              title={`${current.documentType} document for ${current.staffName ?? "staff member"}`}
              className="h-full min-h-[320px] w-full lg:min-h-[520px]"
            />
          )}
        </div>

        <div className="flex flex-col gap-5 lg:w-[45%]">
          <div>
            <p className="text-lg font-semibold text-[#FAFAFA]">{current.staffName ?? "Unknown staff member"}</p>
            <p className="text-sm text-dark-600">{ENGAGEMENT_LABEL[current.engagementType] ?? current.engagementType}</p>
          </div>

          <div className="grid grid-cols-2 gap-4 rounded-xl border border-dark-200 bg-dark-100 p-4">
            <Field label="Document type" value={current.documentType} ocr={false} />
            <Field label="Issuing state" value={current.issuingJurisdiction ?? "—"} ocr={false} />
            <Field label="Certificate number" value={current.documentNumber ?? "—"} ocr={filled.has("documentNumber")} />
            <Field label="Issued" value={current.issueDate ? formatAuDate(current.issueDate) : "—"} ocr={filled.has("issueDate")} />
            <Field label="Expires" value={current.expiryDate ? formatAuDate(current.expiryDate) : "—"} ocr={filled.has("expiryDate")} />
          </div>

          {actionError && <p className="text-sm text-red-400">{actionError}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => resolveCurrent("verify")}
              disabled={actionLoading}
              className="min-h-11 flex-1 rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={actionLoading}
              className="min-h-11 flex-1 rounded-lg border border-dark-300 px-5 py-2.5 text-sm font-semibold text-[#E5E5E5] transition-all duration-200 hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reject
            </button>
          </div>

          {rejecting && (
            <div className="animate-scale-in rounded-lg border border-dark-200 bg-dark-50 p-3">
              <label htmlFor="reject-reason" className="text-xs font-medium text-dark-600">
                Reason for rejection
              </label>
              <textarea
                id="reject-reason"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                placeholder="What does the staff member need to fix?"
                className="mt-1 w-full rounded-lg border border-dark-300 bg-dark px-3 py-2 text-sm text-[#FAFAFA] placeholder:text-dark-500 focus:outline-none"
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRejecting(false);
                    setRejectReason("");
                  }}
                  className="min-h-11 px-3 text-sm text-dark-600 hover:text-[#E5E5E5]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => resolveCurrent("reject", rejectReason.trim())}
                  disabled={!rejectReason.trim() || actionLoading}
                  className="min-h-11 rounded-lg border border-red-500/40 px-4 text-sm font-semibold text-red-400 transition-all duration-200 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Confirm reject
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
