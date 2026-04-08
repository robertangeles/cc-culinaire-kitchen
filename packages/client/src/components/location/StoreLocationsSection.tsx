/**
 * @module components/location/StoreLocationsSection
 *
 * Admin section in ProfilePage Organisation tab for managing store locations.
 * CRUD operations: create, view, edit details, manage staff, view store key.
 * Mirrors the TeamMembersSection pattern.
 */

import { useState, useEffect } from "react";
import {
  MapPin,
  Plus,
  Loader2,
  AlertCircle,
  Copy,
  CheckCircle2,
  Key,
  Users,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  X,
  UserPlus,
  UserMinus,
} from "lucide-react";
import { useLocation } from "../../context/LocationContext";
import { LocationHoursEditor } from "./LocationHoursEditor";

const CLASSIFICATION_LABELS: Record<string, string> = {
  hq: "HQ",
  branch: "Branch",
  commissary: "Commissary",
  satellite: "Satellite",
};

const CLASSIFICATION_BADGE: Record<string, string> = {
  hq: "bg-amber-600/15 text-amber-500",
  branch: "bg-blue-500/15 text-blue-400",
  commissary: "bg-emerald-500/15 text-emerald-400",
  satellite: "bg-purple-500/15 text-purple-400",
};

interface StoreLocationFull {
  storeLocationId: string;
  organisationId: number;
  locationName: string;
  classification: string;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  country: string | null;
  postcode: string | null;
  storeKey: string;
  colorAccent: string | null;
  photoPath: string | null;
  isActiveInd: boolean;
}

interface StaffMember {
  userId: number;
  displayName: string;
  photoPath: string | null;
  assignedAt: string;
}

const inputClass =
  "w-full px-3 py-2 text-sm rounded-lg bg-[#161616] border border-[#2A2A2A] text-white placeholder:text-[#666666] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 min-h-[44px]";

const COLOR_PALETTE = [
  "#FF6B35", "#FFD700", "#4ECDC4", "#5B8DEF",
  "#A855F7", "#F43F5E", "#10B981", "#F59E0B",
];

export function StoreLocationsSection({ orgId }: { orgId: number }) {
  const { refreshLocations } = useLocation();
  const [locations, setLocations] = useState<StoreLocationFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
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

  // Expanded location
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<StoreLocationFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  // Staff for expanded location
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  // Org members (for assigning to locations)
  const [orgMembers, setOrgMembers] = useState<{ userId: number; displayName: string; photoPath: string | null }[]>([]);
  const [orgMembersLoaded, setOrgMembersLoaded] = useState(false);

  // Tabs within expanded location
  const [expandedTab, setExpandedTab] = useState<"details" | "staff" | "hours" | "key">("details");

  async function fetchLocations() {
    setError("");
    try {
      const res = await fetch("/api/store-locations/mine", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load locations");
      const data = await res.json();
      setLocations(data.locations ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLocations();
  }, [orgId]);

  async function fetchStaff(locationId: string) {
    setStaffLoading(true);
    try {
      const res = await fetch(`/api/store-locations/${locationId}/staff`, { credentials: "include" });
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
      setOrgMembers((data.members ?? []).map((m: { userId: number; displayName: string; photoPath: string | null }) => ({
        userId: m.userId,
        displayName: m.displayName,
        photoPath: m.photoPath,
      })));
      setOrgMembersLoaded(true);
    } catch { /* silent */ }
  }

  async function handleAssignStaff(locationId: string, userId: number) {
    setError("");
    try {
      const res = await fetch(`/api/store-locations/${locationId}/staff`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to assign");
      await fetchStaff(locationId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to assign staff");
    }
  }

  async function handleRemoveStaff(locationId: string, userId: number) {
    if (!window.confirm("Remove this staff member from the location?")) return;
    setError("");
    try {
      const res = await fetch(`/api/store-locations/${locationId}/staff/${userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to remove");
      await fetchStaff(locationId);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove staff");
    }
  }

  async function fetchDetail(locationId: string) {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/store-locations/${locationId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load location");
      const data = await res.json();
      setExpandedDetail(data.storeLocation ?? null);
    } catch {
      setExpandedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleExpand(locationId: string) {
    if (expandedId === locationId) {
      setExpandedId(null);
      setEditing(false);
      return;
    }
    setExpandedId(locationId);
    setExpandedTab("details");
    setEditing(false);
    fetchDetail(locationId);
    fetchStaff(locationId);
    fetchOrgMembers();
  }

  function startEditing(loc: StoreLocationFull) {
    setEditName(loc.locationName);
    setEditAddress1(loc.addressLine1 ?? "");
    setEditAddress2(loc.addressLine2 ?? "");
    setEditSuburb(loc.suburb ?? "");
    setEditState(loc.state ?? "");
    setEditCountry(loc.country ?? "");
    setEditPostcode(loc.postcode ?? "");
    setEditColor(loc.colorAccent);
    setEditClassification(loc.classification);
    setEditing(true);
  }

  async function handleSaveEdit(locationId: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/store-locations/${locationId}`, {
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
      await fetchDetail(locationId);
      await fetchLocations();
      await refreshLocations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setSaving(false);
    }
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

      // Reset form
      setCreateName("");
      setCreateClassification("branch");
      setCreateAddress1("");
      setCreateAddress2("");
      setCreateSuburb("");
      setCreateState("");
      setCreateCountry("");
      setCreatePostcode("");
      setCreateColor(null);
      setShowCreate(false);

      await fetchLocations();
      await refreshLocations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create location");
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  async function handleRegenerateKey(locationId: string) {
    if (!window.confirm("Regenerate this store key? The old key will stop working immediately.")) return;
    try {
      const res = await fetch(`/api/store-locations/${locationId}/regenerate-key`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to regenerate key");
      await fetchLocations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to regenerate key");
    }
  }

  async function handleDeactivate(locationId: string) {
    if (!window.confirm("Deactivate this location? All staff will be unassigned.")) return;
    try {
      const res = await fetch(`/api/store-locations/${locationId}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to deactivate");
      await fetchLocations();
      await refreshLocations();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to deactivate");
    }
  }

  return (
    <div className="border-t border-[#2A2A2A] pt-4 mt-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-[#999999]" />
          <h3 className="text-sm font-semibold text-[#E5E5E5]">
            Store Locations ({locations.length})
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg
            bg-[#D4A574] text-[#0A0A0A] hover:bg-[#C4956A] transition-colors min-h-[32px]"
        >
          <Plus className="size-3" />
          Add Location
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          <AlertCircle className="size-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <form onSubmit={handleCreate} className="bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-medium text-[#E5E5E5]">New Store Location</h4>
            <button type="button" onClick={() => setShowCreate(false)} className="text-[#666666] hover:text-[#999999]">
              <X className="size-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-[#999999] mb-1">Kitchen Name *</label>
              <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} required className={inputClass} placeholder="e.g. Main Kitchen" />
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-[#999999] mb-1">Classification</label>
              <select
                value={createClassification}
                onChange={(e) => setCreateClassification(e.target.value)}
                className={inputClass}
              >
                <option value="hq">HQ — Headquarters</option>
                <option value="branch">Branch — Standard location</option>
                <option value="commissary">Commissary — Production kitchen</option>
                <option value="satellite">Satellite — Pop-up / temporary</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-[#999999] mb-1">Address Line 1</label>
              <input type="text" value={createAddress1} onChange={(e) => setCreateAddress1(e.target.value)} className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-[#999999] mb-1">Address Line 2</label>
              <input type="text" value={createAddress2} onChange={(e) => setCreateAddress2(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-[#999999] mb-1">Suburb / City</label>
              <input type="text" value={createSuburb} onChange={(e) => setCreateSuburb(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-[#999999] mb-1">State / Region</label>
              <input type="text" value={createState} onChange={(e) => setCreateState(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-[#999999] mb-1">Country</label>
              <input type="text" value={createCountry} onChange={(e) => setCreateCountry(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-xs text-[#999999] mb-1">Postcode</label>
              <input type="text" value={createPostcode} onChange={(e) => setCreatePostcode(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Color palette */}
          <div>
            <label className="block text-xs text-[#999999] mb-2">Kitchen Color (optional)</label>
            <div className="flex gap-2 flex-wrap">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setCreateColor(createColor === color ? null : color)}
                  className={`w-7 h-7 rounded-lg transition-all duration-200
                    ${createColor === color ? "ring-2 ring-white/40 scale-110" : "ring-1 ring-[#2A2A2A]"}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={creating || !createName.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
              bg-[#D4A574] hover:bg-[#C4956A] text-[#0A0A0A] font-medium text-sm
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-h-[44px]"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : "Create Location"}
          </button>
        </form>
      )}

      {/* Location list */}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-[#666666]" />
        </div>
      ) : locations.length === 0 ? (
        <div className="text-center py-6">
          <MapPin className="size-8 mx-auto text-[#666666] mb-2" />
          <p className="text-sm text-[#666666]">No store locations yet.</p>
          <p className="text-xs text-[#666666] mt-1">Click &ldquo;Add Location&rdquo; to create your first kitchen.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {locations.map((loc) => {
            const isExpanded = expandedId === loc.storeLocationId;
            const badge = CLASSIFICATION_BADGE[loc.classification] ?? "bg-[#1E1E1E] text-[#999999]";
            const address = [loc.addressLine1, loc.suburb, loc.state].filter(Boolean).join(", ");

            return (
              <div key={loc.storeLocationId} className="rounded-xl border border-[#2A2A2A] bg-[#1E1E1E] overflow-hidden">
                {/* Location header — clickable to expand */}
                <button
                  type="button"
                  onClick={() => handleExpand(loc.storeLocationId)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#2A2A2A]/50 transition-colors text-left"
                >
                  {/* Color stripe */}
                  {loc.colorAccent && (
                    <div className="w-1 h-8 rounded-full shrink-0" style={{ backgroundColor: loc.colorAccent }} />
                  )}

                  {/* Icon */}
                  <div className="w-8 h-8 rounded-lg bg-[#161616] flex items-center justify-center shrink-0">
                    <MapPin className="size-3.5 text-[#999999]" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#FAFAFA] truncate">{loc.locationName}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider ${badge}`}>
                        {CLASSIFICATION_LABELS[loc.classification] ?? loc.classification}
                      </span>
                    </div>
                    {address && <p className="text-xs text-[#666666] truncate mt-0.5">{address}</p>}
                  </div>

                  {isExpanded ? <ChevronDown className="size-4 text-[#666666]" /> : <ChevronRight className="size-4 text-[#666666]" />}
                </button>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="border-t border-[#2A2A2A] px-4 py-3">
                    {/* Sub-tabs */}
                    <div className="flex gap-1 mb-3">
                      {(["details", "staff", "hours", "key"] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setExpandedTab(tab)}
                          className={`px-3 py-1.5 text-xs rounded-lg transition-colors capitalize ${
                            expandedTab === tab
                              ? "bg-[#D4A574] text-[#0A0A0A]"
                              : "bg-[#161616] text-[#999999] hover:bg-[#2A2A2A]"
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
                          <Loader2 className="size-4 animate-spin text-[#666666]" />
                        </div>
                      ) : editing && expandedDetail ? (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs text-[#999999] mb-1">Kitchen Name</label>
                              <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className={inputClass} />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-[#999999] mb-1">Classification</label>
                              <select value={editClassification} onChange={(e) => setEditClassification(e.target.value)} className={inputClass}>
                                <option value="hq">HQ</option>
                                <option value="branch">Branch</option>
                                <option value="commissary">Commissary</option>
                                <option value="satellite">Satellite</option>
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-[#999999] mb-1">Address Line 1</label>
                              <input type="text" value={editAddress1} onChange={(e) => setEditAddress1(e.target.value)} className={inputClass} />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs text-[#999999] mb-1">Address Line 2</label>
                              <input type="text" value={editAddress2} onChange={(e) => setEditAddress2(e.target.value)} className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">Suburb / City</label>
                              <input type="text" value={editSuburb} onChange={(e) => setEditSuburb(e.target.value)} className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">State / Region</label>
                              <input type="text" value={editState} onChange={(e) => setEditState(e.target.value)} className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">Country</label>
                              <input type="text" value={editCountry} onChange={(e) => setEditCountry(e.target.value)} className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">Postcode</label>
                              <input type="text" value={editPostcode} onChange={(e) => setEditPostcode(e.target.value)} className={inputClass} />
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-[#999999] mb-2">Kitchen Color</label>
                            <div className="flex gap-2 flex-wrap">
                              {COLOR_PALETTE.map((color) => (
                                <button key={color} type="button" onClick={() => setEditColor(editColor === color ? null : color)}
                                  className={`w-6 h-6 rounded-md transition-all ${editColor === color ? "ring-2 ring-white/40 scale-110" : "ring-1 ring-[#2A2A2A]"}`}
                                  style={{ backgroundColor: color }} />
                              ))}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handleSaveEdit(loc.storeLocationId)} disabled={saving}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#D4A574] text-[#0A0A0A] hover:bg-[#C4956A] disabled:opacity-50 transition-colors">
                              {saving ? <Loader2 className="size-3 animate-spin" /> : "Save"}
                            </button>
                            <button type="button" onClick={() => setEditing(false)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#1E1E1E] text-[#999999] border border-[#2A2A2A] hover:bg-[#2A2A2A] transition-colors">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3 text-sm">
                          {expandedDetail && (
                            <>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                                <div><span className="text-[#666666]">Classification:</span> <span className="text-[#E5E5E5] ml-1">{CLASSIFICATION_LABELS[expandedDetail.classification]}</span></div>
                                {expandedDetail.colorAccent && (
                                  <div className="flex items-center gap-1"><span className="text-[#666666]">Color:</span> <div className="w-4 h-4 rounded ml-1" style={{ backgroundColor: expandedDetail.colorAccent }} /></div>
                                )}
                                {expandedDetail.addressLine1 && <div className="col-span-2"><span className="text-[#666666]">Address:</span> <span className="text-[#E5E5E5] ml-1">{[expandedDetail.addressLine1, expandedDetail.addressLine2].filter(Boolean).join(", ")}</span></div>}
                                {expandedDetail.suburb && <div><span className="text-[#666666]">Suburb:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.suburb}</span></div>}
                                {expandedDetail.state && <div><span className="text-[#666666]">State:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.state}</span></div>}
                                {expandedDetail.country && <div><span className="text-[#666666]">Country:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.country}</span></div>}
                                {expandedDetail.postcode && <div><span className="text-[#666666]">Postcode:</span> <span className="text-[#E5E5E5] ml-1">{expandedDetail.postcode}</span></div>}
                              </div>
                              <div className="flex gap-2 pt-1">
                                <button type="button" onClick={() => startEditing(expandedDetail)}
                                  className="text-xs text-[#D4A574] hover:text-[#C4956A] font-medium transition-colors">
                                  Edit Details
                                </button>
                                {expandedDetail.classification !== "hq" && (
                                  <button type="button" onClick={() => handleDeactivate(loc.storeLocationId)}
                                    className="text-xs text-red-400 hover:text-red-300 transition-colors">
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
                            <Loader2 className="size-4 animate-spin text-[#666666]" />
                          </div>
                        ) : (
                          <>
                            {/* Assigned staff */}
                            <div>
                              <p className="text-xs text-[#999999] mb-2 font-medium">Assigned ({staff.length})</p>
                              {staff.length === 0 ? (
                                <p className="text-xs text-[#666666] py-1">No staff assigned yet.</p>
                              ) : (
                                <div className="space-y-1.5">
                                  {staff.map((s) => (
                                    <div key={s.userId} className="flex items-center gap-2 text-xs bg-[#161616] rounded-lg px-2.5 py-2">
                                      {s.photoPath ? (
                                        <img src={s.photoPath} alt="" className="w-6 h-6 rounded-full object-cover" />
                                      ) : (
                                        <div className="w-6 h-6 rounded-full bg-[#2A2A2A] flex items-center justify-center text-[10px] text-[#999999] font-bold">
                                          {(s.displayName ?? "?")[0].toUpperCase()}
                                        </div>
                                      )}
                                      <span className="text-[#E5E5E5] font-medium flex-1">{s.displayName}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveStaff(loc.storeLocationId, s.userId)}
                                        className="text-[#666666] hover:text-red-400 transition-colors"
                                        title="Remove from location"
                                      >
                                        <UserMinus className="size-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* Unassigned org members — available to assign */}
                            {(() => {
                              const assignedIds = new Set(staff.map((s) => s.userId));
                              const unassigned = orgMembers.filter((m) => !assignedIds.has(m.userId));
                              if (unassigned.length === 0) return null;
                              return (
                                <div className="border-t border-[#2A2A2A] pt-3">
                                  <p className="text-xs text-[#999999] mb-2 font-medium">Available to Assign ({unassigned.length})</p>
                                  <div className="space-y-1.5">
                                    {unassigned.map((m) => (
                                      <div key={m.userId} className="flex items-center gap-2 text-xs bg-[#161616] rounded-lg px-2.5 py-2">
                                        {m.photoPath ? (
                                          <img src={m.photoPath} alt="" className="w-6 h-6 rounded-full object-cover" />
                                        ) : (
                                          <div className="w-6 h-6 rounded-full bg-[#2A2A2A] flex items-center justify-center text-[10px] text-[#999999] font-bold">
                                            {(m.displayName ?? "?")[0].toUpperCase()}
                                          </div>
                                        )}
                                        <span className="text-[#999999] flex-1">{m.displayName}</span>
                                        <button
                                          type="button"
                                          onClick={() => handleAssignStaff(loc.storeLocationId, m.userId)}
                                          className="flex items-center gap-1 text-[10px] text-[#D4A574] hover:text-[#C4956A] font-medium transition-colors"
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
                          <Loader2 className="size-4 animate-spin text-[#666666]" />
                        </div>
                      ) : expandedDetail ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 bg-[#161616] rounded-lg px-3 py-2.5">
                            <Key className="size-4 text-[#D4A574] shrink-0" />
                            <code className="text-sm font-mono font-medium text-[#FAFAFA] flex-1">{expandedDetail.storeKey}</code>
                            <button
                              type="button"
                              onClick={() => handleCopyKey(expandedDetail.storeKey)}
                              className="text-[#666666] hover:text-[#E5E5E5] transition-colors"
                            >
                              {copiedKey === expandedDetail.storeKey ? <CheckCircle2 className="size-4 text-green-500" /> : <Copy className="size-4" />}
                            </button>
                          </div>
                          <p className="text-xs text-[#666666]">
                            Share this key with team members so they can join this location.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleRegenerateKey(loc.storeLocationId)}
                            className="flex items-center gap-1 text-xs text-[#D4A574] hover:text-[#C4956A] transition-colors"
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
          })}
        </div>
      )}
    </div>
  );
}
