/**
 * CSV upload dialog for importing sales data.
 * Dark theme variant matching the Menu Intelligence page.
 */

import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

interface MenuCsvUploadProps {
  onComplete: () => void;
}

export function MenuCsvUpload({ onComplete }: MenuCsvUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ updated: number; notFound: string[] } | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setResult(null);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/api/menu/import-sales`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error ?? "Upload failed");
      }
      const data = await res.json();
      setResult(data);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-[#FAFAFA] mb-2">
        Import Sales Data (CSV)
      </h3>
      <p className="text-xs text-[#666666] mb-3">
        Upload a CSV with columns for item name and units sold. The system will
        match items by name.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-[#D4A574] bg-[#D4A574]/10 rounded-xl border border-[#D4A574]/20 hover:bg-[#D4A574]/20 cursor-pointer transition-colors min-h-[44px]">
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          {uploading ? "Uploading..." : "Choose CSV File"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
        </label>
        {result && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-green-400" />
            <span className="text-green-400">
              {result.updated} items updated
            </span>
            {result.notFound.length > 0 && (
              <span className="text-[#666666]">
                ({result.notFound.length} not matched)
              </span>
            )}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-1.5 text-sm text-red-400">
            <AlertCircle className="size-4" /> {error}
          </div>
        )}
      </div>
      {result?.notFound && result.notFound.length > 0 && (
        <div className="mt-2 text-xs text-[#666666]">
          Not matched: {result.notFound.join(", ")}
        </div>
      )}
    </div>
  );
}
