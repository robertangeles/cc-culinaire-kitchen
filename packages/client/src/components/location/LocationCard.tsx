import { useState, useEffect } from "react";
import {
  MapPin,
  Loader2,
  Copy,
  CheckCircle2,
  Key,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { LocationHoursEditor } from "./LocationHoursEditor";
import type { StoreLocationFull, StaffMember } from "./storeLocationTypes.js";
import { CLASSIFICATION_LABELS, CLASSIFICATION_BADGE, inputClass, COLOR_PALETTE } from "./storeLocationTypes.js";

interface LocationCardProps {
  loc: StoreLocationFull;
  orgId: number;
  isExpanded: boolean;
  onExpand: () => void;
  onRefresh: () => Promise<void>;
}

export function LocationCard({ loc, orgId, isExpanded, onExpand, onRefresh }: LocationCardProps) {
  const [expandedDetail, setExpandedDetail] = useState<StoreLocationFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedTab, setExpandedTab] = useState<"details" | "staff" | "hours" | "key">("details");
  const [copiedKey, setCopiedKey] = useState(false);
  const [error, setError] = useState("");

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editAddress1, setEditAddress1] = useState("");
  const [editAddress2, setEditAddress2] = useState("");
  const [editSuburb, setEditSuburb] = useState("");
  const [editState, setEditState] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editPostcode, setEditPostcode] = useState("");
  const [editColor, setEditColor] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState("branch");
  const [saving, setSaving] = useState(false);

  // Staff
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);
  const [orgMembers, setOrgMembers] = useState<{ userId: number; displayName: string; photoPath: string | null }[]>([]);
  const [orgMembersLoaded, setOrgMembersLoaded] = useState(false);

  useEffect(() => {
    if (isExpanded) {
      setExpandedTab("details");
      setEditing(false);
      fetchDetail();
      fetchStaff();
      fetchOrgMembers();
    }
  // fetchDetail/fetchStaff/fetchOrgMembers are stable within this render cycle;
  // eslint only matters for hooks declared outside
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  async function fetchDetail() {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load location");
      const data = await res.json();
      setExpandedDetail(data.storeLocation ?? null);
    } catch {
      setExpandedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function fetchStaff() {
    setStaffLoading(true);
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}/staff`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load staff");
      const data = await res.json();
      setStaff(data.staff ?? []);
    } catch {
      setStaff([]);
    } finally {
      setStaffLoading(false);
    }
  }

  async function fetchOrgMembers() {
    if (orgMembersLoaded) return;
    try {
      const res = await fetch(`/api/organisations/${orgId}/members`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      setOrgMembers(
        (data.members ?? []).map((m: { userId: number; displayName: string; photoPath: string | null }) => ({
          userId: m.userId,
          displayName: m.displayName,
          photoPath: m.photoPath,
        })),
      );
      setOrgMembersLoaded(true);
    } catch { /* silent */ }
  }

  async function handleAssignStaff(userId: number) {
    setError("");
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}/staff`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to assign");
      await fetchStaff();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to assign staff");
    }
  }

  async function handleRemoveStaff(userId: number) {
    if (!window.confirm("Remove this staff member from the location?")) return;
    setError("");
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}/staff/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove");
      await fetchStaff();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove staff");
    }
  }

  function startEditing(detail: StoreLocationFull) {
    setEditName(detail.locationName);
    setEditAddress1(detail.addressLine1 ?? "");
    setEditAddress2(detail.addressLine2 ?? "");
    setEditSuburb(detail.suburb ?? "");
    setEditState(detail.state ?? "");
    setEditCountry(detail.country ?? "");
    setEditPostcode(detail.postcode ?? "");
    setEditColor(detail.colorAccent);
    setEditClassification(detail.classification);
    setEditing(true);
  }

  async function handleSaveEdit() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationName: editName.trim() || undefined,
          classification: editClassification,
          addressLine1: editAddress1 || undefined,
          addressLine2: editAddress2 || undefined,
          suburb: editSuburb || undefined,
          state: editState || undefined,
          country: editCountry || undefined,
          postcode: editPostcode || undefined,
          colorAccent: editColor || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      setEditing(false);
      await fetchDetail();
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  async function handleRegenerateKey() {
    if (!window.confirm("Regenerate this store key? The old key will stop working immediately.")) return;
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}/regenerate-key`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to regenerate key");
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to regenerate key");
    }
  }

  async function handleDeactivate() {
    if (!window.confirm("Deactivate this location? All staff will be unassigned.")) return;
    try {
      const res = await fetch(`/api/store-locations/${loc.storeLocationId}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to deactivate");
      await onRefresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to deactivate");
    }
  }

  const badge = CLASSIFICATION_BADGE[loc.classification] ?? "bg-dark-100 text-dark-600";
  const address = [loc.addressLine1, loc.suburb, loc.state].filter(Boolean).join(", ");

  return (
    <div className="rounded-xl border border-dark-200 bg-dark-100 overflow-hidden">
      {/* Header — clickable to expand/collapse */}
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-dark-200/50 transition-colors text-left"
      >
        {loc.colorAccent && (
          <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: loc.colorAccent }} />
        )}
        <div className="w-8 h-8 rounded-lg bg-dark-50 flex items-center justify-center shrink-0">
          <MapPin className="size-3.5 text-dark-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-[#FAFAFA] truncate">{loc.locationName}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${badge}`}>
              {CLASSIFICATION_LABELS[loc.classification] ?? loc.classification}
            </span>
          </div>
          {address && <p className="text-xs text-dark-500 truncate mt-0.5">{address}</p>}
        </div>
        {isExpanded ? <ChevronDown className="size-4 text-dark-500" /> : <ChevronRight className="size-4 text-dark-500" />}
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="border-t border-dark-200 px-4 py-3">
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

          {/* Sub-tabs */}
          <div className="flex gap-1 mb-3">
            {(["details", "staff", "hours", "key"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setExpandedTab(tab)}
                className={`px-3 py-1.5 text-xs rounded-lg transition-colors capitalize ${
                  expandedTab === tab ? "bg-gold text-dark" : "bg-dark-50 text-dark-600 hover:bg-dark-200"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Details tab */}
          {expandedTab === "details" && (
            detailLoading ? (
              <div className="flex justify-center py-3">
                <Loader2 className="size-4 animate-spin text-dark-500" />
              </div>
            ) : editing && expandedDetail ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-dark-600 mb-1">Kitchen Name</label>
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-dark-600 mb-1">Classification</label>
                    <select value={editClassification} onChange={(e) => setEditClassification(e.target.value)} className={inputClass}>
                      <option value="hq">HQ</option>
                      <option value="branch">Branch</option>
                      <option value="commissary">Commissary</option>
                      <option value="satellite">Satellite</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-dark-600 mb-1">Address Line 1</label>
                    <input type="text" value={editAddress1} onChange={(e) => setEditAddress1(e.target.value)} className={inputClass} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-dark-600 mb-1">Address Line 2</label>
                    <input type="text" value={editAddress2} onChange={(e) => setEditAddress2(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">Suburb / City</label>
                    <input type="text" value={editSuburb} onChange={(e) => setEditSuburb(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">State / Region</label>
                    <input type="text" value={editState} onChange={(e) => setEditState(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">Country</label>
                    <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">Postcode</label>
                    <input type="text" value={editPostcode} onChange={(e) => setEditPostcode(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-dark-600 mb-2">Kitchen Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {COLOR_PALETTE.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setEditColor(editColor === color ? null : color)}
                        className={`w-6 h-6 rounded-md transition-all ${editColor === color ? "ring-2 ring-white/40 scale-110" : "ring-1 ring-dark-200"}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-gold text-dark hover:bg-gold-hover disabled:opacity-50 transition-colors"
                  >
                    {saving ? <Loader2 className="size-3 animate-spin" /> : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-dark-100 text-dark-600 border border-dark-200 hover:bg-dark-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {expandedDetail && (
                  <>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div>
                        <span className="text-dark-500">Classification:</span>
                        <span className="text-[#E5E5E5] ml-1">{CLASSIFICATION_LABELS[expandedDetail.classification]}</span>
                      </div>
                      {expandedDetail.colorAccent && (
                        <div className="flex items-center gap-1">
                          <span className="text-dark-500">Color:</span>
                          <div className="w-4 h-4 rounded ml-1" style={{ backgroundColor: expandedDetail.colorAccent }} />
                        </div>
                      )}
                      {expandedDetail.addressLine1 && (
                        <div className="col-span-2">
                          <span className="text-dark-500">Address:</span>
                          <span className="text-[#E5E5E5] ml-1">{[expandedDetail.addressLine1, expandedDetail.addressLine2].filter(Boolean).join(", ")}</span>
                        </div>
                      )}
                      {expandedDetail.suburb && <div><span className="text-dark-500">Suburb:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.suburb}</span></div>}
                      {expandedDetail.state && <div><span className="text-dark-500">State:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.state}</span></div>}
                      {expandedDetail.country && <div><span className="text-dark-500">Country:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.country}</span></div>}
                      {expandedDetail.postcode && <div><span className="text-dark-500">Postcode:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.postcode}</span></div>}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => startEditing(expandedDetail)}
                        className="text-xs text-gold hover:text-gold-hover font-medium transition-colors"
                      >
                        Edit Details
                      </button>
                      {expandedDetail.classification !== "hq" && (
                        <button
                          type="button"
                          onClick={handleDeactivate}
                          className="text-xs text-red-400 hover:text-red-300 transition-colors"
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          )}

          {/* Staff tab */}
          {expandedTab === "staff" && (
            <div className="space-y-3">
              {staffLoading ? (
                <div className="flex justify-center py-3">
                  <Loader2 className="size-4 animate-spin text-dark-500" />
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-xs text-dark-600 mb-2 font-medium">Assigned ({staff.length})</p>
                    {staff.length === 0 ? (
                      <p className="text-xs text-dark-500 py-1">No staff assigned yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {staff.map((s) => (
                          <div key={s.userId} className="flex items-center gap-2 text-xs bg-dark-50 rounded-lg px-2.5 py-2">
                            {s.photoPath ? (
                              <img src={s.photoPath} alt="" className="w-6 h-6 rounded-full object-cover" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-dark-200 flex items-center justify-center text-[10px] text-dark-600 font-bold">
                                {(s.displayName ?? "?")[0].toUpperCase()}
                              </div>
                            )}
                            <span className="text-[#E5E5E5] font-medium flex-1">{s.displayName}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveStaff(s.userId)}
                              className="text-dark-500 hover:text-red-400 transition-colors"
                              title="Remove from location"
                            >
                              <UserMinus className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {(() => {
                    const assignedIds = new Set(staff.map((s) => s.userId));
                    const unassigned = orgMembers.filter((m) => !assignedIds.has(m.userId));
                    if (unassigned.length === 0) return null;
                    return (
                      <div className="border-t border-dark-200 pt-3">
                        <p className="text-xs text-dark-600 mb-2 font-medium">Available to Assign ({unassigned.length})</p>
                        <div className="space-y-1.5">
                          {unassigned.map((m) => (
                            <div key={m.userId} className="flex items-center gap-2 text-xs bg-dark-50 rounded-lg px-2.5 py-2">
                              {m.photoPath ? (
                                <img src={m.photoPath} alt="" className="w-6 h-6 rounded-full object-cover" />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-dark-200 flex items-center justify-center text-[10px] text-dark-600 font-bold">
                                  {(m.displayName ?? "?")[0].toUpperCase()}
                                </div>
                              )}
                              <span className="text-dark-600 flex-1">{m.displayName}</span>
                              <button
                                type="button"
                                onClick={() => handleAssignStaff(m.userId)}
                                className="flex items-center gap-1 text-[10px] text-gold hover:text-gold-hover font-medium transition-colors"
                              >
                                <UserPlus className="size-3" />
                                Assign
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

          {/* Hours tab */}
          {expandedTab === "hours" && (
            <LocationHoursEditor storeLocationId={loc.storeLocationId} />
          )}

          {/* Key tab */}
          {expandedTab === "key" && (
            detailLoading ? (
              <div className="flex justify-center py-3">
                <Loader2 className="size-4 animate-spin text-dark-500" />
              </div>
            ) : expandedDetail ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-dark-50 rounded-lg px-3 py-2.5">
                  <Key className="size-4 text-gold shrink-0" />
                  <code className="text-sm font-mono font-medium text-[#FAFAFA] flex-1">{expandedDetail.storeKey}</code>
                  <button
                    type="button"
                    onClick={() => handleCopyKey(expandedDetail.storeKey)}
                    className="text-dark-500 hover:text-[#E5E5E5] transition-colors"
                  >
                    {copiedKey ? <CheckCircle2 className="size-4 text-green-500" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <p className="text-xs text-dark-500">
                  Share this key with team members so they can join this location.
                </p>
                <button
                  type="button"
                  onClick={handleRegenerateKey}
                  className="flex items-center gap-1 text-xs text-gold hover:text-gold-hover transition-colors"
                >
                  <RefreshCw className="size-3" />
                  Regenerate Key
                </button>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
