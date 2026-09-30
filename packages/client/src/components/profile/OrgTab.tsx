import { useState, useEffect, type FormEvent } from "react";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  Info,
  MapPin,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext.js";
import { MyKitchenTab } from "./MyKitchenTab.js";
import { StoreLocationsSection } from "../location/StoreLocationsSection.js";
import type { Organisation, OrgMember } from "./profileTypes.js";

const inputClass =
  "w-full rounded-xl border border-dark-200 px-3 py-2 text-sm text-white bg-dark placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent";

function OrgBenchBanner({ orgId }: { orgId: number }) {
  const [banner, setBanner] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const channelKey = `org_${orgId}`;
  const API = import.meta.env.VITE_API_URL ?? "";

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/api/bench/channels`, { credentials: "include" });
        if (!res.ok) return;
        const channels = await res.json();
        const ch = channels.find((c: any) => c.channelKey === channelKey);
        if (ch?.channelBanner) setBanner(ch.channelBanner);
      } catch {
        // silent
      } finally {
        setLoaded(true);
      }
    }
    load();
  }, [channelKey]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`${API}/api/bench/channels/${channelKey}/banner`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ banner }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;

  return (
    <div className="border-t border-dark-200 pt-3 mt-3">
      <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
        My Kitchen Banner
      </label>
      <p className="text-xs text-dark-500 mb-2">
        This message appears at the top of your organisation's chat channel in The Bench.
      </p>
      <textarea
        value={banner}
        onChange={(e) => setBanner(e.target.value.slice(0, 500))}
        rows={2}
        maxLength={500}
        placeholder="e.g., Team — menu tasting Friday 3pm. Bring your best seasonal dish idea."
        className="w-full rounded-xl border border-dark-200 px-3 py-2 text-sm text-white bg-dark placeholder-dark-400 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-transparent resize-none"
      />
      <div className="flex items-center justify-between mt-1">
        <span className={`text-xs ${banner.length > 450 ? "text-gold" : "text-dark-500"}`}>
          {banner.length}/500
        </span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Banner"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OrgTab() {
  const { user } = useAuth();

  const [org, setOrg] = useState<Organisation | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [myOrgRole, setMyOrgRole] = useState<string>("member");
  const [orgTab, setOrgTab] = useState<"create" | "join">("create");
  const [orgSubTab, setOrgSubTab] = useState<"overview" | "locations">("overview");
  const [orgMsg, setOrgMsg] = useState("");
  const [orgError, setOrgError] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Create-org form
  const [orgName, setOrgName] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [orgPhone, setOrgPhone] = useState("");
  const [orgFacebook, setOrgFacebook] = useState("");
  const [orgInstagram, setOrgInstagram] = useState("");
  const [orgTiktok, setOrgTiktok] = useState("");
  const [orgPinterest, setOrgPinterest] = useState("");
  const [orgLinkedin, setOrgLinkedin] = useState("");

  // Join-org form
  const [joinKey, setJoinKey] = useState("");

  // Edit-org form
  const [editingOrg, setEditingOrg] = useState(false);
  const [editOrgName, setEditOrgName] = useState("");
  const [editOrgAddressLine1, setEditOrgAddressLine1] = useState("");
  const [editOrgAddressLine2, setEditOrgAddressLine2] = useState("");
  const [editOrgSuburb, setEditOrgSuburb] = useState("");
  const [editOrgStateProv, setEditOrgStateProv] = useState("");
  const [editOrgCountry, setEditOrgCountry] = useState("");
  const [editOrgPostcode, setEditOrgPostcode] = useState("");
  const [editOrgWebsite, setEditOrgWebsite] = useState("");
  const [editOrgEmail, setEditOrgEmail] = useState("");
  const [editOrgPhone, setEditOrgPhone] = useState("");
  const [editOrgFacebook, setEditOrgFacebook] = useState("");
  const [editOrgInstagram, setEditOrgInstagram] = useState("");
  const [editOrgTiktok, setEditOrgTiktok] = useState("");
  const [editOrgPinterest, setEditOrgPinterest] = useState("");
  const [editOrgLinkedin, setEditOrgLinkedin] = useState("");

  // Fetch user's organisation — re-runs when user?.userId resolves after auth
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/organisations/mine", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          const fetchedOrg = data.organisation;
          setOrg(fetchedOrg);
          if (fetchedOrg) {
            try {
              const mRes = await fetch(`/api/organisations/${fetchedOrg.organisationId}/members`, { credentials: "include" });
              if (mRes.ok) {
                const mData = await mRes.json();
                const me = (mData.members ?? []).find((m: OrgMember) => m.userId === user?.userId);
                if (me) setMyOrgRole(me.role);
              }
            } catch { /* ignore */ }
          }
        }
      } catch {
        // ignore
      } finally {
        setOrgLoading(false);
      }
    })();
  }, [user?.userId]);

  async function handleCreateOrg(e: FormEvent) {
    e.preventDefault();
    setOrgMsg("");
    setOrgError("");
    setSavingOrg(true);
    try {
      const res = await fetch("/api/organisations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: orgName,
          website: orgWebsite || undefined,
          email: orgEmail || undefined,
          phone: orgPhone || undefined,
          facebook: orgFacebook || undefined,
          instagram: orgInstagram || undefined,
          tiktok: orgTiktok || undefined,
          pinterest: orgPinterest || undefined,
          linkedin: orgLinkedin || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create organisation");
      setOrg(data.organisation);
      setMyOrgRole("admin");
      setOrgMsg("Organisation created!");
    } catch (err: unknown) {
      setOrgError(err instanceof Error ? err.message : "Creation failed");
    } finally {
      setSavingOrg(false);
    }
  }

  async function handleJoinOrg(e: FormEvent) {
    e.preventDefault();
    setOrgMsg("");
    setOrgError("");
    setSavingOrg(true);
    try {
      const res = await fetch("/api/organisations/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ joinKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to join organisation");
      setOrg(data.organisation);
      setMyOrgRole("member");
      setOrgMsg("Joined organisation!");
    } catch (err: unknown) {
      setOrgError(err instanceof Error ? err.message : "Join failed");
    } finally {
      setSavingOrg(false);
    }
  }

  async function handleLeaveOrg() {
    if (!org) return;
    setSavingOrg(true);
    try {
      await fetch(`/api/organisations/${org.organisationId}/leave`, {
        method: "DELETE",
        credentials: "include",
      });
      setOrg(null);
      setMyOrgRole("member");
      setOrgMsg("Left organisation.");
    } catch {
      setOrgError("Failed to leave organisation.");
    } finally {
      setSavingOrg(false);
    }
  }

  function startEditingOrg() {
    if (!org) return;
    setEditOrgName(org.organisationName);
    setEditOrgAddressLine1(org.organisationAddressLine1 ?? "");
    setEditOrgAddressLine2(org.organisationAddressLine2 ?? "");
    setEditOrgSuburb(org.organisationSuburb ?? "");
    setEditOrgStateProv(org.organisationState ?? "");
    setEditOrgCountry(org.organisationCountry ?? "");
    setEditOrgPostcode(org.organisationPostcode ?? "");
    setEditOrgWebsite(org.organisationWebsite ?? "");
    setEditOrgEmail(org.organisationEmail ?? "");
    setEditOrgPhone(org.organisationPhone ?? "");
    setEditOrgFacebook(org.organisationFacebook ?? "");
    setEditOrgInstagram(org.organisationInstagram ?? "");
    setEditOrgTiktok(org.organisationTiktok ?? "");
    setEditOrgPinterest(org.organisationPinterest ?? "");
    setEditOrgLinkedin(org.organisationLinkedin ?? "");
    setEditingOrg(true);
  }

  async function handleUpdateOrg(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    setOrgMsg("");
    setOrgError("");
    setSavingOrg(true);
    try {
      const res = await fetch(`/api/organisations/${org.organisationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: editOrgName,
          addressLine1: editOrgAddressLine1 || undefined,
          addressLine2: editOrgAddressLine2 || undefined,
          suburb: editOrgSuburb || undefined,
          state: editOrgStateProv || undefined,
          country: editOrgCountry || undefined,
          postcode: editOrgPostcode || undefined,
          website: editOrgWebsite || undefined,
          email: editOrgEmail || undefined,
          phone: editOrgPhone || undefined,
          facebook: editOrgFacebook || undefined,
          instagram: editOrgInstagram || undefined,
          tiktok: editOrgTiktok || undefined,
          pinterest: editOrgPinterest || undefined,
          linkedin: editOrgLinkedin || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update organisation");
      setOrg(data.organisation);
      setOrgMsg("Organisation updated!");
      setEditingOrg(false);
    } catch (err: unknown) {
      setOrgError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingOrg(false);
    }
  }

  async function handleCopyKey() {
    if (!org) return;
    await navigator.clipboard.writeText(org.joinKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  return (
    <div role="tabpanel" id="profile-tabpanel-kitchen" aria-labelledby="profile-tab-kitchen" className="bg-dark-50 rounded-2xl border border-dark-200 p-6 space-y-4">
      {orgMsg && (
        <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
          <CheckCircle2 className="size-4 flex-shrink-0" /> {orgMsg}
        </div>
      )}
      {orgError && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" /> {orgError}
        </div>
      )}

      {orgLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-dark-500" />
        </div>
      ) : org ? (
        <div>
          {/* Sub-tab navigation */}
          <div className="flex gap-1 mb-4">
            {([
              { id: "overview" as const, label: "Overview", Icon: Info },
              { id: "locations" as const, label: "Locations", Icon: MapPin },
            ]).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setOrgSubTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  orgSubTab === id
                    ? "bg-gold text-dark font-medium"
                    : "bg-dark-100 text-dark-600 hover:bg-dark-200"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* ── Overview sub-tab ─────────────────────────────── */}
          {orgSubTab === "overview" && (
            <div className="space-y-4">
              {user && myOrgRole === "admin" && editingOrg ? (
                <form onSubmit={handleUpdateOrg} className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Organisation Name *</label>
                    <input type="text" value={editOrgName} onChange={(e) => setEditOrgName(e.target.value)} required className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Website</label>
                    <input type="text" value={editOrgWebsite} onChange={(e) => setEditOrgWebsite(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Email</label>
                    <input type="email" value={editOrgEmail} onChange={(e) => setEditOrgEmail(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Phone</label>
                    <input type="tel" value={editOrgPhone} onChange={(e) => setEditOrgPhone(e.target.value)} placeholder="e.g. +61 3 9999 0000" className={inputClass} />
                  </div>
                  <div className="border-t border-dark-200 pt-3 mt-1">
                    <h4 className="text-sm font-semibold text-[#E5E5E5] mb-3">Social Media Accounts</h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs text-dark-600 mb-1">Facebook</label>
                        <input type="url" value={editOrgFacebook} onChange={(e) => setEditOrgFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-dark-600 mb-1">Instagram</label>
                        <input type="url" value={editOrgInstagram} onChange={(e) => setEditOrgInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-dark-600 mb-1">TikTok</label>
                        <input type="url" value={editOrgTiktok} onChange={(e) => setEditOrgTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-dark-600 mb-1">Pinterest</label>
                        <input type="url" value={editOrgPinterest} onChange={(e) => setEditOrgPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-dark-600 mb-1">LinkedIn</label>
                        <input type="url" value={editOrgLinkedin} onChange={(e) => setEditOrgLinkedin(e.target.value)} placeholder="https://linkedin.com/company/yourorg" className={inputClass} />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" disabled={savingOrg} className="px-4 py-2 text-sm font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors">
                      {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                      Save Changes
                    </button>
                    <button type="button" onClick={() => setEditingOrg(false)} className="px-4 py-2 text-sm font-medium text-[#E5E5E5] bg-dark-100 border border-dark-200 rounded-xl hover:bg-dark-200 transition-colors">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-dark-600">Name:</span>
                      <p className="font-medium text-[#FAFAFA]">{org.organisationName}</p>
                    </div>
                    {org.organisationWebsite && (
                      <div>
                        <span className="text-dark-600">Website:</span>
                        <p className="font-medium text-[#FAFAFA]">{org.organisationWebsite}</p>
                      </div>
                    )}
                    {org.organisationEmail && (
                      <div>
                        <span className="text-dark-600">Email:</span>
                        <p className="font-medium text-[#FAFAFA]">{org.organisationEmail}</p>
                      </div>
                    )}
                  </div>

                  {(org.organisationFacebook || org.organisationInstagram || org.organisationTiktok || org.organisationPinterest || org.organisationLinkedin) && (
                    <div className="border-t border-dark-200 pt-3">
                      <p className="text-xs text-dark-600 mb-2">Social Media</p>
                      <div className="flex flex-wrap gap-2 text-sm">
                        {org.organisationFacebook && <a href={org.organisationFacebook} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-hover hover:underline">Facebook</a>}
                        {org.organisationInstagram && <a href={org.organisationInstagram} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-hover hover:underline">Instagram</a>}
                        {org.organisationTiktok && <a href={org.organisationTiktok} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-hover hover:underline">TikTok</a>}
                        {org.organisationPinterest && <a href={org.organisationPinterest} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-hover hover:underline">Pinterest</a>}
                        {org.organisationLinkedin && <a href={org.organisationLinkedin} target="_blank" rel="noopener noreferrer" className="text-gold hover:text-gold-hover hover:underline">LinkedIn</a>}
                      </div>
                    </div>
                  )}

                  {user && myOrgRole === "admin" && (
                    <button type="button" onClick={startEditingOrg} className="text-sm text-gold hover:text-gold-hover transition-colors">
                      Edit Organisation
                    </button>
                  )}

                  {user && myOrgRole === "admin" && (
                    <OrgBenchBanner orgId={org.organisationId} />
                  )}
                </>
              )}

              {/* Join Key + Leave */}
              <div className="border-t border-dark-200 pt-3 space-y-3">
                <div className="flex items-center gap-2 bg-dark border border-dark-200 rounded-lg px-3 py-2">
                  <span className="text-sm text-dark-600">Org Join Key:</span>
                  <code className="text-sm font-mono font-medium text-[#FAFAFA]">{org.joinKey}</code>
                  <button type="button" onClick={handleCopyKey} className="ml-auto text-dark-500 hover:text-[#E5E5E5] transition-colors" title="Copy join key">
                    {copiedKey ? <CheckCircle2 className="size-4 text-green-500" /> : <Copy className="size-4" />}
                  </button>
                </div>
                <button type="button" onClick={handleLeaveOrg} disabled={savingOrg} className="text-sm text-red-400 hover:text-red-300 transition-colors">
                  Leave Organisation
                </button>
              </div>

              {/* ── Kitchen Profile ──────────────────────────── */}
              <div className="border-t border-dark-200 pt-4 mt-4">
                <MyKitchenTab isOrgAdmin={myOrgRole === "admin"} />
              </div>
            </div>
          )}

          {/* ── Locations sub-tab ───────────────────────────── */}
          {orgSubTab === "locations" && user && myOrgRole === "admin" && (
            <StoreLocationsSection orgId={org.organisationId} />
          )}
          {orgSubTab === "locations" && myOrgRole !== "admin" && (
            <p className="text-sm text-dark-500 py-4">Only organisation admins can manage store locations.</p>
          )}
        </div>
      ) : (
        <div>
          <div role="tablist" aria-label="Organisation action" className="flex gap-2 mb-4">
            <button
              type="button"
              role="tab"
              aria-selected={orgTab === "create"}
              aria-controls="org-tabpanel-create"
              id="org-tab-create"
              onClick={() => setOrgTab("create")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${orgTab === "create" ? "bg-gold text-dark" : "bg-dark-100 text-dark-600 hover:bg-dark-200"}`}
            >
              Create
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={orgTab === "join"}
              aria-controls="org-tabpanel-join"
              id="org-tab-join"
              onClick={() => setOrgTab("join")}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${orgTab === "join" ? "bg-gold text-dark" : "bg-dark-100 text-dark-600 hover:bg-dark-200"}`}
            >
              Join
            </button>
          </div>

          {orgTab === "create" ? (
            <form onSubmit={handleCreateOrg} role="tabpanel" id="org-tabpanel-create" aria-labelledby="org-tab-create" className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Organisation Name *</label>
                <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} required className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Website</label>
                <input type="text" value={orgWebsite} onChange={(e) => setOrgWebsite(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Email</label>
                <input type="email" value={orgEmail} onChange={(e) => setOrgEmail(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Phone</label>
                <input type="tel" value={orgPhone} onChange={(e) => setOrgPhone(e.target.value)} placeholder="e.g. +61 3 9999 0000" className={inputClass} />
              </div>

              <div className="border-t border-dark-200 pt-3 mt-1">
                <h4 className="text-sm font-semibold text-[#E5E5E5] mb-3">Social Media Accounts</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">Facebook</label>
                    <input type="url" value={orgFacebook} onChange={(e) => setOrgFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">Instagram</label>
                    <input type="url" value={orgInstagram} onChange={(e) => setOrgInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">TikTok</label>
                    <input type="url" value={orgTiktok} onChange={(e) => setOrgTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">Pinterest</label>
                    <input type="url" value={orgPinterest} onChange={(e) => setOrgPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-dark-600 mb-1">LinkedIn</label>
                    <input type="url" value={orgLinkedin} onChange={(e) => setOrgLinkedin(e.target.value)} placeholder="https://linkedin.com/company/yourorg" className={inputClass} />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={savingOrg}
                className="px-4 py-2 text-sm font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors"
              >
                {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                Create Organisation
              </button>
            </form>
          ) : (
            <form onSubmit={handleJoinOrg} role="tabpanel" id="org-tabpanel-join" aria-labelledby="org-tab-join" className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Join Key</label>
                <input
                  type="text"
                  value={joinKey}
                  onChange={(e) => setJoinKey(e.target.value)}
                  required
                  className={inputClass}
                  placeholder="Enter the join key from your organisation"
                />
              </div>
              <button
                type="submit"
                disabled={savingOrg}
                className="px-4 py-2 text-sm font-medium text-dark bg-gold rounded-xl hover:bg-gold-hover disabled:opacity-50 transition-colors"
              >
                {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                Join Organisation
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
