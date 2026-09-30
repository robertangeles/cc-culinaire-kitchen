import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { StoreLocationFull } from "./storeLocationTypes.js";
import { inputClass, COLOR_PALETTE } from "./storeLocationTypes.js";

interface LocationCreateFormProps {
  orgId: number;
  locations: StoreLocationFull[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function LocationCreateForm({ orgId, locations, onClose, onRefresh }: LocationCreateFormProps) {
  const [createName, setCreateName] = useState("");
  const [createClassification, setCreateClassification] = useState("branch");
  const [createAddress1, setCreateAddress1] = useState("");
  const [createAddress2, setCreateAddress2] = useState("");
  const [createSuburb, setCreateSuburb] = useState("");
  const [createState, setCreateState] = useState("");
  const [createCountry, setCreateCountry] = useState("");
  const [createPostcode, setCreatePostcode] = useState("");
  const [createColor, setCreateColor] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copySourceId, setCopySourceId] = useState<string | null>(null);
  const [copyResult, setCopyResult] = useState<{ created: number; skipped: string[]; failed: string[] } | null>(null);
  const [copying, setCopying] = useState(false);
  const [lastCreatedLocationId, setLastCreatedLocationId] = useState<string | null>(null);
  const [error, setError] = useState("");

  /**
   * Copies the given role names onto targetVenueId. Fired in parallel:
   * this dev environment's API has observed 400ms-5s per-request latency,
   * and nothing here depends on another call's result (the duplicate-name
   * backstop is the DB's unique index, not a check-as-you-go). Also used
   * by "Retry failed" against the previously-created venue, so it takes
   * the role list explicitly rather than re-deriving it from the source
   * venue each time.
   */
  async function copyRoleNamesToVenue(roleNames: string[], targetVenueId: string) {
    setCopying(true);
    try {
      const results = await Promise.allSettled(
        roleNames.map(async (roleName) => {
          const res = await fetch("/api/roster/roles", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roleName, storeLocationId: targetVenueId }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            const err = new Error(body.error ?? "Failed to copy role") as Error & { status?: number };
            err.status = res.status;
            throw err;
          }
          return roleName;
        }),
      );

      let created = 0;
      const skipped: string[] = [];
      const failed: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") created++;
        else if ((r.reason as { status?: number })?.status === 409) skipped.push(roleNames[i]);
        else failed.push(roleNames[i]);
      });
      return { created, skipped, failed };
    } finally {
      setCopying(false);
    }
  }

  async function handleRetryFailedCopies() {
    if (!copyResult || !lastCreatedLocationId) return;
    const retryResult = await copyRoleNamesToVenue(copyResult.failed, lastCreatedLocationId);
    setCopyResult({
      created: copyResult.created + retryResult.created,
      skipped: [...copyResult.skipped, ...retryResult.skipped],
      failed: retryResult.failed,
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!createName.trim()) return;
    setCreating(true);
    setError("");

    try {
      const res = await fetch("/api/store-locations", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: orgId,
          locationName: createName.trim(),
          classification: createClassification,
          addressLine1: createAddress1 || undefined,
          addressLine2: createAddress2 || undefined,
          suburb: createSuburb || undefined,
          state: createState || undefined,
          country: createCountry || undefined,
          postcode: createPostcode || undefined,
          colorAccent: createColor || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create location");

      const newLocationId: string = data.storeLocation.storeLocationId;
      let result: { created: number; skipped: string[]; failed: string[] } | null = null;
      if (copySourceId) {
        const rolesRes = await fetch("/api/roster/roles", { credentials: "include" });
        const allRoles: { roleName: string; storeLocationId: string | null }[] = await rolesRes.json();
        const sourceRoleNames = allRoles.filter((r) => r.storeLocationId === copySourceId).map((r) => r.roleName);
        result = sourceRoleNames.length > 0 ? await copyRoleNamesToVenue(sourceRoleNames, newLocationId) : null;
        setCopyResult(result);
        setLastCreatedLocationId(newLocationId);
      }

      await onRefresh();

      // Keep form open (with copy-result visible) when a copy was attempted
      // so the admin can see the outcome and retry failures. The venue itself
      // is already created at this point, so closing immediately would hide it.
      if (!result) {
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create location");
    } finally {
      setCreating(false);
    }
  }

  return (
    <form onSubmit={handleCreate} className="bg-dark-100 border border-dark-200 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-sm font-medium text-[#E5E5E5]">New Store Location</h4>
        <button type="button" onClick={onClose} className="text-dark-500 hover:text-dark-600">
          <X className="size-4" />
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs text-dark-600 mb-1">Kitchen Name *</label>
          <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} required className={inputClass} placeholder="e.g. Main Kitchen" />
        </div>

        <div className="col-span-2">
          <label className="block text-xs text-dark-600 mb-1">Classification</label>
          <select value={createClassification} onChange={(e) => setCreateClassification(e.target.value)} className={inputClass}>
            <option value="hq">HQ — Headquarters</option>
            <option value="branch">Branch — Standard location</option>
            <option value="commissary">Commissary — Production kitchen</option>
            <option value="satellite">Satellite — Pop-up / temporary</option>
          </select>
        </div>

        {locations.length > 0 && !copyResult && (
          <div className="col-span-2">
            <label className="block text-xs text-dark-600 mb-1">Copy roles from an existing venue (optional)</label>
            <select value={copySourceId ?? ""} onChange={(e) => setCopySourceId(e.target.value || null)} className={inputClass}>
              <option value="">Don't copy roles</option>
              {locations.map((loc) => (
                <option key={loc.storeLocationId} value={loc.storeLocationId}>
                  {loc.locationName}
                </option>
              ))}
            </select>
          </div>
        )}

        {copyResult && (
          <div role="alert" className="col-span-2 rounded-lg border border-gold/20 bg-gold/10 px-3 py-2 text-xs text-gold space-y-2 animate-scale-in">
            <p>
              Copied {copyResult.created} role{copyResult.created === 1 ? "" : "s"}
              {copyResult.skipped.length > 0 && `, skipped ${copyResult.skipped.length} (already exists)`}
              {copyResult.failed.length > 0 && `, ${copyResult.failed.length} failed`}.
            </p>
            {copyResult.failed.length > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleRetryFailedCopies}
                  disabled={copying}
                  className="flex items-center gap-1.5 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-dark hover:bg-gold-hover disabled:opacity-50"
                >
                  {copying && <Loader2 className="size-3 animate-spin" />}
                  Retry failed
                </button>
              </div>
            )}
          </div>
        )}

        <div className="col-span-2">
          <label className="block text-xs text-dark-600 mb-1">Address Line 1</label>
          <input type="text" value={createAddress1} onChange={(e) => setCreateAddress1(e.target.value)} className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-dark-600 mb-1">Address Line 2</label>
          <input type="text" value={createAddress2} onChange={(e) => setCreateAddress2(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-dark-600 mb-1">Suburb / City</label>
          <input type="text" value={createSuburb} onChange={(e) => setCreateSuburb(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-dark-600 mb-1">State / Region</label>
          <input type="text" value={createState} onChange={(e) => setCreateState(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-dark-600 mb-1">Country</label>
          <input type="text" value={createCountry} onChange={(e) => setCreateCountry(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className="block text-xs text-dark-600 mb-1">Postcode</label>
          <input type="text" value={createPostcode} onChange={(e) => setCreatePostcode(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div>
        <label className="block text-xs text-dark-600 mb-2">Kitchen Color (optional)</label>
        <div className="flex gap-2 flex-wrap">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => setCreateColor(createColor === color ? null : color)}
              className={`w-7 h-7 rounded-lg transition-all duration-200 ${createColor === color ? "ring-2 ring-white/40 scale-110" : "ring-1 ring-dark-200"}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {!copyResult && (
        <button
          type="submit"
          disabled={creating || !createName.trim()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gold hover:bg-gold-hover text-dark font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px]"
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : "Create Location"}
        </button>
      )}
    </form>
  );
}
