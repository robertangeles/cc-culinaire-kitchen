/**
 * @module components/compliance/VenueDocumentForm
 *
 * CV-E: some documents belong to a venue, not a person — liquor licence,
 * food business registration. There's no "self" for a venue, so this is a
 * manager action (compliance:verify), not the staff self-upload flow
 * DocumentUploadForm covers. Same two-step upload-then-create pattern:
 * `POST /documents/upload` stores the file, `POST /documents/venue` records
 * it against a store_location subject instead of a user_id one.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { inputClass } from "./documentFormShared.js";

const API = import.meta.env.VITE_API_URL ?? "";

const DOCUMENT_TYPES = ["Liquor Licence", "Food Business Registration", "Public Liability Insurance", "Other"];

interface Venue {
  storeLocationId: string;
  locationName: string;
}

export function VenueDocumentForm() {
  const [open, setOpen] = useState(false);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venuesError, setVenuesError] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState("");
  const [otherType, setOtherType] = useState("");
  const [storeLocationId, setStoreLocationId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [storagePublicId, setStoragePublicId] = useState<string | null>(null);
  const [storageFormat, setStorageFormat] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expiryDate, setExpiryDate] = useState("");

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const submitGuard = useRef(false);

  const effectiveType = documentType === "Other" ? otherType.trim() : documentType;

  useEffect(() => {
    if (!open || venues !== null) return;
    (async () => {
      try {
        const res = await fetch(`${API}/api/users/location-context`, { credentials: "include" });
        if (!res.ok) throw new Error();
        const data: { locations: Venue[] } = await res.json();
        setVenues(data.locations);
      } catch {
        setVenuesError("Couldn't load your venues.");
        setVenues([]);
      }
    })();
  }, [open, venues]);

  function reset() {
    setDocumentType("");
    setOtherType("");
    setStoreLocationId("");
    setFile(null);
    setStoragePublicId(null);
    setStorageFormat(null);
    setUploadError(null);
    setExpiryDate("");
    setSubmitError(null);
    setDone(false);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setFile(chosen);
    setStoragePublicId(null);
    setStorageFormat(null);
    setUploadError(null);
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
      const data: { storagePublicId: string; storageFormat?: string } = await res.json();
      setStoragePublicId(data.storagePublicId);
      setStorageFormat(data.storageFormat ?? null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't read that file. Try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitGuard.current || !effectiveType || !storeLocationId || !storagePublicId) return;
    submitGuard.current = true;
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`${API}/api/compliance/documents/venue`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentType: effectiveType,
          storeLocationId,
          expiryDate: expiryDate || null,
          storagePublicId,
          storageFormat,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save this document. Try again.");
      }
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Couldn't save this document. Try again.");
    } finally {
      setIsSubmitting(false);
      submitGuard.current = false;
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-semibold text-gold underline hover:text-gold-hover"
      >
        + Add venue document
      </button>
    );
  }

  if (done) {
    return (
      <div className="rounded-xl border border-dark-200 bg-dark-100 p-4">
        <div className="flex items-center gap-2 text-sm text-[#E5E5E5]">
          <CheckCircle2 className="size-4 text-gold" aria-hidden="true" />
          Venue document saved.
        </div>
        <button
          type="button"
          onClick={reset}
          className="mt-2 text-sm font-semibold text-gold underline hover:text-gold-hover"
        >
          Add another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-dark-200 bg-dark-100 p-4 animate-fade-in-up"
    >
      <p className="text-sm font-semibold text-[#FAFAFA]">Add venue document</p>

      <div>
        <label htmlFor="venue-document-type" className="text-xs font-medium text-dark-600">
          Document type
        </label>
        <select
          id="venue-document-type"
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
        <label htmlFor="venue-picker" className="text-xs font-medium text-dark-600">
          Venue
        </label>
        <select
          id="venue-picker"
          value={storeLocationId}
          onChange={(e) => setStoreLocationId(e.target.value)}
          className={inputClass}
          disabled={venues === null}
        >
          <option value="">{venues === null ? "Loading venues…" : "Choose a venue"}</option>
          {venues?.map((v) => (
            <option key={v.storeLocationId} value={v.storeLocationId}>
              {v.locationName}
            </option>
          ))}
        </select>
        {venuesError && <p className="mt-1 text-xs text-red-400">{venuesError}</p>}
      </div>

      <div>
        <label
          htmlFor="venue-document-file"
          className={`flex min-h-11 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm font-medium transition-all duration-200 ${
            effectiveType
              ? "cursor-pointer border-dark-300 bg-dark-50 text-gold hover:border-gold hover:bg-gold-dim/40"
              : "cursor-not-allowed border-dark-200 bg-dark-50 text-dark-500"
          }`}
        >
          {uploading ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          <span>{file ? file.name : uploading ? "Uploading…" : "Choose a file"}</span>
          <input
            id="venue-document-file"
            type="file"
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            disabled={!effectiveType || uploading}
            className="hidden"
          />
        </label>
        {uploadError && <p className="mt-2 text-sm text-red-400">{uploadError}</p>}
      </div>

      <div>
        <label htmlFor="venue-expiry-date" className="text-xs font-medium text-dark-600">
          Expires (if applicable)
        </label>
        <input
          id="venue-expiry-date"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className={inputClass}
        />
      </div>

      {submitError && <p className="text-sm text-red-400">{submitError}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isSubmitting || uploading || !effectiveType || !storeLocationId || !storagePublicId}
          className="min-h-11 flex-1 rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
        >
          {isSubmitting ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-11 rounded-lg border border-dark-300 px-4 text-sm font-semibold text-[#E5E5E5] hover:border-gold hover:text-gold"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
