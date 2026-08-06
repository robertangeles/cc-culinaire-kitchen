/**
 * @module components/compliance/MyDocumentsList
 *
 * A staff member's own compliance documents. Pending is the state that
 * matters most and is usually left undesigned as a bare "Pending" label —
 * here it says who has it and since when, so waiting doesn't feel like a
 * black hole. Rejected shows the reason so the staff member knows what to
 * fix without having to ask.
 */

import { useEffect, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { formatAuDate } from "@culinaire/shared";
import { EmptyState } from "../ui/EmptyState.js";
import { StatusPill, type StatusPillVariant } from "../ui/StatusPill.js";

const API = import.meta.env.VITE_API_URL ?? "";

interface MyDocument {
  complianceDocumentId: string;
  documentType: string;
  verificationStatus: string;
  expiryDate: string | null;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/api/compliance/documents/mine`, { credentials: "include" });
        if (!res.ok) throw new Error("Couldn't load your documents.");
        const data: MyDocument[] = await res.json();
        if (!cancelled) setDocuments(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load your documents.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    <ul className="divide-y divide-dark-200 rounded-xl border border-dark-200 bg-dark-100 animate-fade-in-up">
      {documents.map((doc) => (
        <li key={doc.complianceDocumentId} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-[#FAFAFA]">{doc.documentType}</p>
            <StatusPill variant={STATUS_VARIANT[doc.verificationStatus] ?? "na"} ariaLabel={pillAriaLabel(doc)}>
              {doc.verificationStatus}
            </StatusPill>
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
          {doc.verificationStatus === "Rejected" && doc.rejectionReason && (
            <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
              <p className="font-medium text-red-400">What to fix</p>
              <p className="mt-0.5">{doc.rejectionReason}</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
