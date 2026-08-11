/**
 * @module components/compliance/CompliancePdfDownloadButton
 *
 * The "one click" in one-click audit PDF: GET /api/compliance/report.pdf,
 * saved via an object URL. Org-wide only — this dashboard has no venue
 * selector, so storeLocationId is never sent. Mirrors the fetch → blob →
 * createObjectURL → click-a-hidden-anchor steps in useInventory's
 * downloadPdf; there is no equivalent hook on this screen, so the same
 * steps live inline here.
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { useHasPermission } from "../../hooks/useHasPermission.js";

/** The server sets a dated filename on Content-Disposition — read it rather than guessing the date format client-side. */
function filenameFromContentDisposition(header: string | null): string | null {
  return header?.match(/filename="?([^"]+)"?/)?.[1] ?? null;
}

export function CompliancePdfDownloadButton() {
  const hasPermission = useHasPermission();
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasPermission("compliance:read-all")) return null;

  async function handleClick() {
    setIsDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/compliance/report.pdf", { credentials: "include" });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromContentDisposition(res.headers.get("Content-Disposition")) ?? "compliance-report.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't generate the report. Try again.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={isDownloading}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-dark-300 bg-dark-100 px-4 py-2 text-sm font-semibold text-[#FAFAFA] transition-all duration-200 hover:-translate-y-0.5 hover:border-gold disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
      >
        {isDownloading ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Download className="size-4" aria-hidden="true" />
        )}
        {isDownloading ? "Preparing PDF…" : "Download audit PDF"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
