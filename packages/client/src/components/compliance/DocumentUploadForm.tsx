/**
 * @module components/compliance/DocumentUploadForm
 *
 * Staff upload flow, phone-first (designed at 375px). Pick a document type,
 * photograph or choose a file, correct whatever OCR got wrong or missed, send
 * for review.
 *
 * Fields OCR pre-fills carry the same gold-dot "read from photo" marker as
 * the manager's VerificationView — every field stays editable regardless.
 *
 * `POST /api/compliance/documents/upload` stores the file (private Cloudinary,
 * magic-byte sniffed) and returns `{ storagePublicId, storageFormat, ocr }`.
 * `storageFormat` ("pdf" | "jpg" | "png") is echoed straight back on the
 * `POST /api/compliance/documents` call below so the server can mint a
 * correctly-shaped signed URL later — it is never guessed on the client.
 */

import { useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { EmptyState } from "../ui/EmptyState.js";
import { formatAuDate } from "@culinaire/shared";

const API = import.meta.env.VITE_API_URL ?? "";

const DOCUMENT_TYPES = [
  "RSA",
  "Food Safety Supervisor",
  "Working with Children Check",
  "Police Check",
  "Food Handler",
  "Visa / Work Rights",
  "Other",
];

const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

interface OcrResult {
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
}

function OcrMark() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="size-1.5 rounded-full bg-gold" aria-hidden="true" />
      <span className="text-[10px] font-normal text-gold">read from photo</span>
    </span>
  );
}

const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-dark-300 bg-dark px-3 text-sm text-[#FAFAFA] placeholder:text-dark-500 focus:outline-none";

export function DocumentUploadForm({ onUploaded }: { onUploaded?: () => void }) {
  const [documentType, setDocumentType] = useState("");
  const [otherType, setOtherType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [storagePublicId, setStoragePublicId] = useState<string | null>(null);
  const [storageFormat, setStorageFormat] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ocrFilled, setOcrFilled] = useState<Set<string>>(new Set());

  const [documentNumber, setDocumentNumber] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [issuingJurisdiction, setIssuingJurisdiction] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const submitGuard = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveType = documentType === "Other" ? otherType.trim() : documentType;

  function reset() {
    setDocumentType("");
    setOtherType("");
    setFile(null);
    setStoragePublicId(null);
    setStorageFormat(null);
    setUploadError(null);
    setOcrFilled(new Set());
    setDocumentNumber("");
    setIssueDate("");
    setExpiryDate("");
    setIssuingJurisdiction("");
    setSubmitError(null);
    setDone(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setStoragePublicId(null);
    setStorageFormat(null);
    setUploadError(null);
    setOcrFilled(new Set());
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", chosen);
      const res = await fetch(`${API}/api/compliance/documents/upload`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't read that file. Try again.");
      }
      const data: { storagePublicId: string; storageFormat?: string; ocr?: OcrResult } = await res.json();
      setStoragePublicId(data.storagePublicId);
      setStorageFormat(data.storageFormat ?? null);

      const filled = new Set<string>();
      if (data.ocr?.documentNumber) {
        setDocumentNumber(data.ocr.documentNumber);
        filled.add("documentNumber");
      }
      if (data.ocr?.issueDate) {
        setIssueDate(data.ocr.issueDate);
        filled.add("issueDate");
      }
      if (data.ocr?.expiryDate) {
        setExpiryDate(data.ocr.expiryDate);
        filled.add("expiryDate");
      }
      setOcrFilled(filled);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't read that file. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Guard set synchronously, before the first await, so a second tap that
    // lands before React re-renders the disabled button still no-ops.
    if (submitGuard.current || !effectiveType || !storagePublicId) return;
    submitGuard.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API}/api/compliance/documents`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: effectiveType,
          documentNumber: documentNumber.trim() || null,
          issueDate: issueDate || null,
          expiryDate: expiryDate || null,
          issuingJurisdiction: issuingJurisdiction || null,
          storagePublicId,
          storageFormat,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't send this for review. Try again.");
      }
      setDone(true);
      onUploaded?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't send this for review. Try again.");
    } finally {
      setIsSubmitting(false);
      submitGuard.current = false;
    }
  }

  if (done) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Sent for review"
        body="Your manager will check it against the photo and verify it's current. You'll see the result on My Documents."
        action={{ label: "Upload another certificate", onClick: reset }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-sm flex-col gap-5 p-4 animate-fade-in-up">
      <div>
        <label htmlFor="document-type" className="text-xs font-medium text-dark-600">
          Document type
        </label>
        <select
          id="document-type"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value)}
          className={inputClass}
        >
          <option value="">Choose a document type</option>
          {DOCUMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {documentType === "Other" && (
          <input
            type="text"
            value={otherType}
            onChange={(e) => setOtherType(e.target.value)}
            placeholder="Name the document"
            aria-label="Document name"
            maxLength={40}
            className={inputClass}
          />
        )}
      </div>

      <div>
        <label
          htmlFor="document-file"
          className={`flex min-h-11 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm font-medium transition-all duration-200 ${
            documentType
              ? "cursor-pointer border-dark-300 bg-dark-50 text-gold hover:border-gold hover:bg-gold-dim/40"
              : "cursor-not-allowed border-dark-200 bg-dark-50 text-dark-500"
          }`}
        >
          {uploading ? <Loader2 className="size-6 animate-spin" /> : <Camera className="size-6" />}
          <span>{file ? file.name : uploading ? "Reading photo…" : "Take a photo or choose a file"}</span>
          <input
            id="document-file"
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={handleFileChange}
            disabled={!documentType || uploading}
            className="hidden"
          />
        </label>
        {uploadError && <p className="mt-2 text-sm text-red-400">{uploadError}</p>}
      </div>

      <div>
        <label htmlFor="document-number" className="flex items-center gap-1.5 text-xs font-medium text-dark-600">
          Certificate number
          {ocrFilled.has("documentNumber") && <OcrMark />}
        </label>
        <input
          id="document-number"
          type="text"
          value={documentNumber}
          onChange={(e) => setDocumentNumber(e.target.value)}
          maxLength={100}
          className={inputClass}
        />
      </div>

      {/* A native date input renders in the BROWSER's locale, which we do not
          control — the same field shows dd/mm/yyyy to a user in Melbourne and
          mm/dd/yyyy to one whose browser is set to en-US. On an expiry date
          that ambiguity is not cosmetic: 08/07/2026 is either 8 July or
          7 August, four weeks apart, on the field that decides whether someone
          is legal to work. The rendered value below each input is the
          unambiguous long form, so what was entered is always readable. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="issue-date" className="flex items-center gap-1.5 text-xs font-medium text-dark-600">
            Issued
            {ocrFilled.has("issueDate") && <OcrMark />}
          </label>
          <input
            id="issue-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className={inputClass}
          />
          {issueDate && (
            <p className="mt-1 text-xs text-dark-600">{formatAuDate(issueDate)}</p>
          )}
        </div>
        <div>
          <label htmlFor="expiry-date" className="flex items-center gap-1.5 text-xs font-medium text-dark-600">
            Expires
            {ocrFilled.has("expiryDate") && <OcrMark />}
          </label>
          <input
            id="expiry-date"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className={inputClass}
          />
          {expiryDate && (
            <p className="mt-1 text-xs text-dark-600">{formatAuDate(expiryDate)}</p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="issuing-state" className="text-xs font-medium text-dark-600">
          Issuing state
        </label>
        <select
          id="issuing-state"
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

      {submitError && <p className="text-sm text-red-400">{submitError}</p>}

      <button
        type="submit"
        disabled={isSubmitting || uploading || !effectiveType || !storagePublicId}
        className="min-h-11 rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isSubmitting ? "Sending…" : "Send for review"}
      </button>
    </form>
  );
}
