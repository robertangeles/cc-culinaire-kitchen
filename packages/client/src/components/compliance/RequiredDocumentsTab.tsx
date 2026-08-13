/**
 * @module components/compliance/RequiredDocumentsTab
 *
 * Admin control for which document types this organisation requires of
 * every staff member — the switch that gives the rest of the Compliance
 * vault meaning. With zero types selected, every staff member reads as
 * compliant by default: nothing is actually being checked. That's why the
 * empty state below is a warning, not the calm "all clear" used elsewhere
 * in this module (compare VerificationView's "All caught up" — that state
 * IS an achievement; this one never is).
 *
 * GET/PUT /api/compliance/required-documents (complianceController.ts
 * handleListRequiredDocuments / handleSetRequiredDocuments) both return the
 * organisation's required types as a plain string[]. PUT is a wholesale
 * replace (complianceService.setRequiredDocuments deletes and re-inserts),
 * so every toggle below sends the FULL desired set, not a delta.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

// Duplicated from DocumentUploadForm.tsx's DOCUMENT_TYPES — that file is
// outside this change's ownership and doesn't export the list. If it ever
// gains an export, switch this to import it instead: two independently
// edited copies of the upload vocabulary WILL drift, and a requirement an
// operator can never upload against is exactly the failure this list exists
// to prevent.
//
// "Other" is deliberately left out even though DocumentUploadForm offers it:
// on upload it's a free-text stand-in — the form persists whatever the staff
// member typed, never the literal string "Other" — so a document's stored
// type can never actually equal "Other". Requiring it would be a
// requirement nobody could ever satisfy.
const REQUIRABLE_DOCUMENT_TYPES = [
  "RSA",
  "Food Safety Supervisor",
  "Working with Children Check",
  "Police Check",
  "Food Handler",
  "Visa / Work Rights",
];

type Status = "loading" | "error" | "ready";

export function RequiredDocumentsTab() {
  const [status, setStatus] = useState<Status>("loading");
  const [required, setRequired] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setSaveError(null);
    try {
      const res = await fetch(`${API}/api/compliance/required-documents`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data: string[] = await res.json();
      setRequired(data);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // No optimistic flip here on purpose: `required` only changes once the
  // server confirms the new set, so a failed save needs no rollback — the
  // checkbox simply never moved. Guarded so a second tap while a save is
  // in flight can't race it with a stale `required` snapshot.
  async function handleToggle(type: string) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(type);
    setSaveError(null);
    const next = required.includes(type) ? required.filter((t) => t !== type) : [...required, type];
    try {
      const res = await fetch(`${API}/api/compliance/required-documents`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentTypes: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Couldn't save that change. Try again.");
      }
      const data: string[] = await res.json();
      setRequired(data);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save that change. Try again.");
    } finally {
      setSaving(null);
      savingRef.current = false;
    }
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center p-6 py-16">
        <Loader2 className="size-6 animate-spin text-gold" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div role="alert" className="m-6 rounded-xl border border-dark-200 bg-dark-100 px-4 py-10 text-center">
        <p className="text-sm text-[#E5E5E5]">
          We couldn&apos;t load your organisation&apos;s required documents. Please try again.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-dark transition-all duration-200 hover:-translate-y-0.5 hover:bg-gold-hover"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  return (
    // p-6 because this now lives in Settings, whose content wrapper supplies no
    // padding of its own — every sibling tab (RolesTab, UsersTab, …) brings its
    // own. It was written for the compliance page's padded container, so without
    // this it sits flush against the top and right edges.
    <div className="animate-fade-in-up space-y-6 p-6">
      <div>
        <h2 className="text-lg font-semibold text-[#FAFAFA]">Requirements</h2>
        <p className="mt-1 text-sm text-dark-600">
          Turning on a document type here means every staff member must hold a current one — it&apos;s
          what the rest of the Compliance vault checks against.
        </p>
      </div>

      {required.length === 0 && (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-[#FAFAFA]">Nothing is required yet</p>
            <p className="mt-1 text-sm text-[#E5E5E5]">
              With no document types selected, every staff member reads as compliant by default —
              the vault isn&apos;t checking anything. Turn on a document type below to start.
            </p>
          </div>
        </div>
      )}

      {saveError && (
        <p role="alert" className="text-sm text-red-400">
          {saveError}
        </p>
      )}

      <ul className="divide-y divide-dark-200 rounded-xl border border-dark-200 bg-dark-100">
        {REQUIRABLE_DOCUMENT_TYPES.map((type) => {
          const checked = required.includes(type);
          const inputId = `required-document-${type.replace(/\s+/g, "-").toLowerCase()}`;
          return (
            <li key={type} className="flex min-h-11 items-center justify-between gap-4 p-4">
              <label htmlFor={inputId} className="flex flex-1 cursor-pointer items-start gap-3">
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  disabled={saving !== null}
                  onChange={() => handleToggle(type)}
                  // Explicit aria-label rather than relying on the wrapping
                  // <label>'s text: that label also contains the "Required
                  // of every staff member" / "Not required" caption, which
                  // would otherwise get concatenated into the accessible
                  // name (e.g. "RSA Not required.").
                  aria-label={type}
                  // accent-gold, not text-gold: text-* only tints a native
                  // checkbox via the @tailwindcss/forms plugin, which this
                  // project does not install — so it shipped browser-default
                  // blue on an otherwise gold-and-dark screen. accent-color
                  // is the plain CSS route and needs no plugin.
                  className="mt-0.5 size-5 shrink-0 rounded border-dark-300 bg-dark accent-gold focus:outline-none focus:ring-2 focus:ring-gold-ring"
                />
                <span>
                  <span className="block text-sm font-medium text-[#FAFAFA]">{type}</span>
                  <span className="block text-xs text-dark-600">
                    {checked ? `Every staff member must hold a current ${type}.` : "Not required."}
                  </span>
                </span>
              </label>
              {saving === type && <Loader2 className="size-4 shrink-0 animate-spin text-gold" aria-hidden="true" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
