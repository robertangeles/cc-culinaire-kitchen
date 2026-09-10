/**
 * @module components/organisation/OrganisationBrandingForm
 *
 * Organisation Settings: branding (logo, accent colour) + operational
 * defaults (timezone, currency, jurisdiction). Metadata only for now — not
 * wired into resolveJurisdiction()/getVenueTimezone() or new-location
 * creation, which stay per-store-location on purpose (a multi-location org
 * can legitimately span jurisdictions).
 */

import { useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Upload } from "lucide-react";

const COLOR_PALETTE = [
  "#FF6B35", "#FFD700", "#4ECDC4", "#5B8DEF",
  "#A855F7", "#F43F5E", "#10B981", "#F59E0B",
];

const AU_TIMEZONES = [
  "Australia/Melbourne",
  "Australia/Sydney",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Australia/Hobart",
];

const CURRENCIES = ["AUD", "USD", "NZD", "GBP", "EUR"];

const AU_JURISDICTIONS = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

const inputClass =
  "mt-1 w-full rounded-lg border border-dark-300 bg-dark px-3 py-2 text-sm text-[#FAFAFA] focus:outline-none";

export interface OrganisationSettings {
  organisationId: number;
  organisationName: string;
  organisationLogoPath: string | null;
  organisationColorAccent: string | null;
  defaultTimezone: string;
  defaultCurrency: string;
  defaultJurisdiction: string | null;
}

export function OrganisationBrandingForm({
  org,
  onUpdated,
}: {
  org: OrganisationSettings;
  onUpdated: (org: OrganisationSettings) => void;
}) {
  const [colorAccent, setColorAccent] = useState(org.organisationColorAccent);
  const [defaultTimezone, setDefaultTimezone] = useState(org.defaultTimezone);
  const [defaultCurrency, setDefaultCurrency] = useState(org.defaultCurrency);
  const [defaultJurisdiction, setDefaultJurisdiction] = useState(org.defaultJurisdiction ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/organisations/${org.organisationId}/logo`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to upload logo");
      onUpdated(data.organisation);
      setMessage("Logo updated!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to upload logo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const res = await fetch(`/api/organisations/${org.organisationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          // name is required by the shared PATCH schema even though this
          // form doesn't edit it (that's the org-details form's job) — pass
          // the current value through unchanged.
          name: org.organisationName,
          colorAccent: colorAccent || "",
          defaultTimezone,
          defaultCurrency,
          defaultJurisdiction: defaultJurisdiction || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save organisation settings");
      onUpdated(data.organisation);
      setMessage("Organisation settings saved!");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save organisation settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {message}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-[#E5E5E5] mb-2">Branding</h3>
        <div className="flex items-center gap-4 mb-4">
          {org.organisationLogoPath ? (
            <img
              src={org.organisationLogoPath}
              alt="Organisation logo"
              className="size-16 rounded-xl object-cover border border-dark-200"
            />
          ) : (
            <div className="size-16 rounded-xl border border-dashed border-dark-300 flex items-center justify-center text-dark-500 text-xs">
              No logo
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#E5E5E5] bg-dark-100 border border-dark-200 rounded-lg hover:bg-dark-200 disabled:opacity-50 transition-colors"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            Upload logo
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
        </div>

        <label className="block text-xs text-dark-600 mb-2">Accent colour</label>
        <div className="flex gap-2 flex-wrap">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setColorAccent(colorAccent === color ? null : color)}
              className={`w-6 h-6 rounded-md transition-all ${colorAccent === color ? "ring-2 ring-white/40 scale-110" : "ring-1 ring-dark-200"}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-[#E5E5E5] mb-2">Operational defaults</h3>
          <p className="text-xs text-dark-500 mb-3">
            Used as a starting point across the org. Each store location keeps its own timezone and jurisdiction for
            compliance and rostering — these are not changed by editing the defaults here.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-dark-600 mb-1">Timezone</label>
              <select value={defaultTimezone} onChange={(e) => setDefaultTimezone(e.target.value)} className={inputClass}>
                {AU_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-dark-600 mb-1">Currency</label>
              <select value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)} className={inputClass}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-dark-600 mb-1">Jurisdiction</label>
              <select value={defaultJurisdiction} onChange={(e) => setDefaultJurisdiction(e.target.value)} className={inputClass}>
                <option value="">Not set</option>
                {AU_JURISDICTIONS.map((j) => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors"
        >
          {saving && <Loader2 className="size-4 animate-spin inline mr-1" />}
          Save Changes
        </button>
      </form>
    </div>
  );
}
