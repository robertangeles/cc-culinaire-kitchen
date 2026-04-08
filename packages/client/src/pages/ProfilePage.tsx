/**
 * @module pages/ProfilePage
 *
 * User profile page with editable name, password change,
 * and organisation create/join functionality.
 */

import { useState, useEffect, useRef, type FormEvent, type ElementType, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import {
  User,
  Users,
  Building2,
  Key,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  ShieldCheck,
  Camera,
  UtensilsCrossed,
  MapPin,
  Info,
} from "lucide-react";
import { MyKitchenTab } from "../components/profile/MyKitchenTab.js";
import { useAuth } from "../context/AuthContext.js";
import { ImageCropModal } from "../components/ui/ImageCropModal.js";
import { StoreLocationsSection } from "../components/location/StoreLocationsSection.js";

const tabs: { id: "account" | "password" | "kitchen"; label: string; Icon: ElementType }[] = [
  { id: "account", label: "Account Details", Icon: User },
  { id: "password", label: "Change Password", Icon: Key },
  { id: "kitchen", label: "Profile", Icon: UtensilsCrossed },
];

interface Organisation {
  organisationId: number;
  organisationName: string;
  organisationAddressLine1: string | null;
  organisationAddressLine2: string | null;
  organisationSuburb: string | null;
  organisationState: string | null;
  organisationCountry: string | null;
  organisationPostcode: string | null;
  organisationWebsite: string | null;
  organisationEmail: string | null;
  organisationFacebook: string | null;
  organisationInstagram: string | null;
  organisationTiktok: string | null;
  organisationPinterest: string | null;
  organisationLinkedin: string | null;
  joinKey: string;
  createdBy: number;
}

interface OrgMember {
  userId: number;
  displayName: string;
  photoPath: string | null;
  bio: string | null;
  role: "admin" | "member";
  joinedAt: string;
}

/** Derive a deterministic background color from a userId */
function avatarColor(userId: number): string {
  const colors = [
    "bg-rose-500", "bg-amber-500", "bg-emerald-500", "bg-cyan-500",
    "bg-blue-500", "bg-violet-500", "bg-fuchsia-500", "bg-teal-500",
    "bg-orange-500", "bg-indigo-500",
  ];
  return colors[userId % colors.length];
}

/** Team Members list for the Organisation tab */
function TeamMembersSection({ orgId, currentUserId }: { orgId: number; currentUserId: number }) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Derive admin status from the members list — not from createdBy
  const isOrgAdmin = members.some(m => m.userId === currentUserId && m.role === "admin");

  async function fetchMembers() {
    setError("");
    try {
      const res = await fetch(`/api/organisations/${orgId}/members`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load members");
      const data = await res.json();
      setMembers(data.members ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load members");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMembers();
  }, [orgId]);

  async function handleToggleRole(member: OrgMember) {
    const newRole = member.role === "admin" ? "member" : "admin";
    const label = newRole === "admin" ? "Admin" : "Member";
    if (!window.confirm(`Change ${member.displayName}'s role to ${label}?`)) return;
    try {
      const res = await fetch(`/api/organisations/${orgId}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update role");
      }
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    }
  }

  async function handleRemove(member: OrgMember) {
    if (!window.confirm(`Remove ${member.displayName} from the organisation? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/organisations/${orgId}/members/${member.userId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to remove member");
      }
      await fetchMembers();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  return (
    <div className="border-t border-[#2A2A2A] pt-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="size-4 text-[#999999]" />
        <h3 className="text-sm font-semibold text-[#E5E5E5]">
          Team Members ({members.length})
        </h3>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3">
          <AlertCircle className="size-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="size-5 animate-spin text-[#666666]" />
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-[#666666] italic">No members found.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const initial = (m.displayName ?? "?").charAt(0).toUpperCase();
            return (
              <div
                key={m.userId}
                className="flex items-center gap-3 rounded-xl border border-[#2A2A2A] bg-[#1E1E1E] px-3 py-2.5"
              >
                {/* Avatar */}
                {m.photoPath ? (
                  <img
                    src={m.photoPath}
                    alt={m.displayName}
                    className="size-10 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div
                    className={`size-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${avatarColor(m.userId)}`}
                  >
                    {initial}
                  </div>
                )}

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-[#FAFAFA] truncate">
                      {m.displayName}
                    </span>
                    {isSelf && (
                      <span className="text-xs text-[#666666]">(You)</span>
                    )}
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.role === "admin"
                          ? "bg-[#D4A574]/15 text-[#D4A574]"
                          : "bg-[#1E1E1E] text-[#999999]"
                      }`}
                    >
                      {m.role === "admin" ? "Admin" : "Member"}
                    </span>
                  </div>
                  {m.bio && (
                    <p className="text-xs text-[#666666] truncate mt-0.5">
                      {m.bio.length > 100 ? `${m.bio.slice(0, 100)}...` : m.bio}
                    </p>
                  )}
                </div>

                {/* Actions — only for admins, and not on self */}
                {isOrgAdmin && !isSelf && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => handleToggleRole(m)}
                      className="text-xs text-[#D4A574] hover:text-[#C4956A] font-medium transition-colors"
                    >
                      {m.role === "admin" ? "Make Member" : "Make Admin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(m)}
                      className="text-xs text-red-400 hover:text-red-300 font-medium transition-colors"
                    >
                      Remove
                    </button>
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

/** Inline component for org owners to edit their My Kitchen bench banner */
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
    <div className="border-t border-[#2A2A2A] pt-3 mt-3">
      <label className="block text-sm font-medium text-[#E5E5E5] mb-1">
        My Kitchen Banner
      </label>
      <p className="text-xs text-[#666666] mb-2">
        This message appears at the top of your organisation's chat channel in The Bench.
      </p>
      <textarea
        value={banner}
        onChange={(e) => setBanner(e.target.value.slice(0, 500))}
        rows={2}
        maxLength={500}
        placeholder="e.g., Team — menu tasting Friday 3pm. Bring your best seasonal dish idea."
        className="w-full rounded-xl border border-[#2A2A2A] px-3 py-2 text-sm text-white bg-[#0A0A0A] placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent resize-none"
      />
      <div className="flex items-center justify-between mt-1">
        <span className={`text-xs ${banner.length > 450 ? "text-[#D4A574]" : "text-[#666666]"}`}>
          {banner.length}/500
        </span>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1 text-xs font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save Banner"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  // Tabs
  const [activeTab, setActiveTab] = useState<"account" | "password" | "kitchen">("account");

  // Profile
  const [name, setName] = useState(user?.userName ?? "");
  const [bio, setBio] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [suburb, setSuburb] = useState("");
  const [stateProv, setStateProv] = useState("");
  const [country, setCountry] = useState("");
  const [postcode, setPostcode] = useState("");
  const [facebook, setFacebook] = useState("");
  const [instagram, setInstagram] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [pinterest, setPinterest] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [profileMsg, setProfileMsg] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Organisation
  const [org, setOrg] = useState<Organisation | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [myOrgRole, setMyOrgRole] = useState<string>("member");
  const [orgTab, setOrgTab] = useState<"create" | "join">("create");
  const [orgSubTab, setOrgSubTab] = useState<"overview" | "team" | "locations">("overview");
  const [orgName, setOrgName] = useState("");
  const [orgAddressLine1, setOrgAddressLine1] = useState("");
  const [orgAddressLine2, setOrgAddressLine2] = useState("");
  const [orgSuburb, setOrgSuburb] = useState("");
  const [orgStateProv, setOrgStateProv] = useState("");
  const [orgCountry, setOrgCountry] = useState("");
  const [orgPostcode, setOrgPostcode] = useState("");
  const [orgWebsite, setOrgWebsite] = useState("");
  const [orgEmail, setOrgEmail] = useState("");
  const [orgFacebook, setOrgFacebook] = useState("");
  const [orgInstagram, setOrgInstagram] = useState("");
  const [orgTiktok, setOrgTiktok] = useState("");
  const [orgPinterest, setOrgPinterest] = useState("");
  const [orgLinkedin, setOrgLinkedin] = useState("");
  const [joinKey, setJoinKey] = useState("");
  const [orgMsg, setOrgMsg] = useState("");
  const [orgError, setOrgError] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
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
  const [editOrgFacebook, setEditOrgFacebook] = useState("");
  const [editOrgInstagram, setEditOrgInstagram] = useState("");
  const [editOrgTiktok, setEditOrgTiktok] = useState("");
  const [editOrgPinterest, setEditOrgPinterest] = useState("");
  const [editOrgLinkedin, setEditOrgLinkedin] = useState("");

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState("");
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  // Track the last-saved profile values for dirty detection
  const savedProfileRef = useRef({
    name: user?.userName ?? "",
    bio: "",
    addressLine1: "",
    addressLine2: "",
    suburb: "",
    stateProv: "",
    country: "",
    postcode: "",
    facebook: "",
    instagram: "",
    tiktok: "",
    pinterest: "",
    linkedin: "",
  });

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError("");

    // Read file as data URL and open crop modal
    const reader = new FileReader();
    reader.onload = () => {
      setCropImageSrc(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleCroppedUpload(blob: Blob) {
    setCropImageSrc(null);
    const formData = new FormData();
    formData.append("file", blob, "avatar.jpg");

    try {
      const res = await fetch("/api/users/profile/avatar", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (res.ok) {
        refreshUser();
      } else if (res.status === 401) {
        setAvatarError("Session expired. Please refresh the page and try again.");
      } else {
        const data = await res.json().catch(() => ({}));
        setAvatarError(data.error ?? "Upload failed. Check file size (max 2 MB) and type.");
      }
    } catch {
      setAvatarError("Network error — please try again.");
    }
  }

  useEffect(() => {
    const n = user?.userName ?? "";
    setName(n);
    savedProfileRef.current.name = n;
  }, [user]);

  // Fetch full profile (address, bio, social media) on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/users/profile", { credentials: "include" });
        if (res.ok) {
          const { profile } = await res.json();
          const vals = {
            bio: profile.userBio ?? "",
            addressLine1: profile.userAddressLine1 ?? "",
            addressLine2: profile.userAddressLine2 ?? "",
            suburb: profile.userSuburb ?? "",
            stateProv: profile.userState ?? "",
            country: profile.userCountry ?? "",
            postcode: profile.userPostcode ?? "",
            facebook: profile.userFacebook ?? "",
            instagram: profile.userInstagram ?? "",
            tiktok: profile.userTiktok ?? "",
            pinterest: profile.userPinterest ?? "",
            linkedin: profile.userLinkedin ?? "",
          };
          setBio(vals.bio);
          setAddressLine1(vals.addressLine1);
          setAddressLine2(vals.addressLine2);
          setSuburb(vals.suburb);
          setStateProv(vals.stateProv);
          setCountry(vals.country);
          setPostcode(vals.postcode);
          setFacebook(vals.facebook);
          setInstagram(vals.instagram);
          setTiktok(vals.tiktok);
          setPinterest(vals.pinterest);
          setLinkedin(vals.linkedin);
          savedProfileRef.current = { ...savedProfileRef.current, ...vals };
        }
      } catch {
        // ignore — fields will remain empty
      }
    })();
  }, []);

  // Fetch user's organisation on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/organisations/mine", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          const fetchedOrg = data.organisation;
          setOrg(fetchedOrg);
          // Fetch current user's role from members list
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
  }, []);

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setProfileMsg("");
    setProfileError("");
    setSavingProfile(true);
    try {
      const res = await fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userName: name,
          userBio: bio || undefined,
          userAddressLine1: addressLine1 || undefined,
          userAddressLine2: addressLine2 || undefined,
          userSuburb: suburb || undefined,
          userState: stateProv || undefined,
          userCountry: country || undefined,
          userPostcode: postcode || undefined,
          userFacebook: facebook || undefined,
          userInstagram: instagram || undefined,
          userTiktok: tiktok || undefined,
          userPinterest: pinterest || undefined,
          userLinkedin: linkedin || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update profile");
      setProfileMsg("Profile updated.");
      savedProfileRef.current = { name, bio, addressLine1, addressLine2, suburb, stateProv, country, postcode, facebook, instagram, tiktok, pinterest, linkedin };
      await refreshUser();
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg("");
    setPasswordError("");
    setSavingPassword(true);
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to change password");
      setPasswordMsg("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : "Change failed");
    } finally {
      setSavingPassword(false);
    }
  }

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
          addressLine1: orgAddressLine1 || undefined,
          addressLine2: orgAddressLine2 || undefined,
          suburb: orgSuburb || undefined,
          state: orgStateProv || undefined,
          country: orgCountry || undefined,
          postcode: orgPostcode || undefined,
          website: orgWebsite || undefined,
          email: orgEmail || undefined,
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

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  function isAccountDirty(): boolean {
    const s = savedProfileRef.current;
    return (
      name !== s.name ||
      bio !== s.bio ||
      addressLine1 !== s.addressLine1 ||
      addressLine2 !== s.addressLine2 ||
      suburb !== s.suburb ||
      stateProv !== s.stateProv ||
      country !== s.country ||
      postcode !== s.postcode ||
      facebook !== s.facebook ||
      instagram !== s.instagram ||
      tiktok !== s.tiktok ||
      pinterest !== s.pinterest ||
      linkedin !== s.linkedin
    );
  }

  function switchTab(newTab: typeof activeTab) {
    if (activeTab === "account" && newTab !== "account" && isAccountDirty()) {
      // Fire-and-forget auto-save
      fetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userName: name,
          userBio: bio || undefined,
          userAddressLine1: addressLine1 || undefined,
          userAddressLine2: addressLine2 || undefined,
          userSuburb: suburb || undefined,
          userState: stateProv || undefined,
          userCountry: country || undefined,
          userPostcode: postcode || undefined,
          userFacebook: facebook || undefined,
          userInstagram: instagram || undefined,
          userTiktok: tiktok || undefined,
          userPinterest: pinterest || undefined,
          userLinkedin: linkedin || undefined,
        }),
      })
        .then((res) => {
          if (res.ok) {
            savedProfileRef.current = { name, bio, addressLine1, addressLine2, suburb, stateProv, country, postcode, facebook, instagram, tiktok, pinterest, linkedin };
            refreshUser();
            setProfileMsg("Auto-saved");
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = setTimeout(() => setProfileMsg(""), 2000);
          }
        })
        .catch(() => {});
    }
    setActiveTab(newTab);
  }

  function handleProfileTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = tabs.findIndex((t) => t.id === activeTab);
    const next =
      e.key === "ArrowRight"
        ? (idx + 1) % tabs.length
        : (idx - 1 + tabs.length) % tabs.length;
    switchTab(tabs[next].id);
    document.getElementById(`profile-tab-${tabs[next].id}`)?.focus();
  }

  const inputClass =
    "w-full rounded-xl border border-[#2A2A2A] px-3 py-2 text-sm text-white bg-[#0A0A0A] placeholder-[#444444] focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50 focus:border-transparent";

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-[#0A0A0A]">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-bold text-[#FAFAFA]">Profile</h1>

        {/* Tab Bar */}
        <div role="tablist" aria-label="Profile" className="flex gap-1 bg-[#161616] rounded-xl p-1 border border-[#2A2A2A]">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`profile-tabpanel-${tab.id}`}
              id={`profile-tab-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => switchTab(tab.id)}
              onKeyDown={handleProfileTabKeyDown}
              className={`flex items-center gap-2 flex-1 justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-[#D4A574] text-[#0A0A0A]"
                  : "text-[#999999] hover:text-[#E5E5E5]"
              }`}
            >
              <tab.Icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Account Details Tab */}
        {activeTab === "account" && (
          <form onSubmit={handleSaveProfile} role="tabpanel" id="profile-tabpanel-account" aria-labelledby="profile-tab-account" className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6 space-y-4">
            {profileMsg && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <CheckCircle2 className="size-4 flex-shrink-0" /> {profileMsg}
              </div>
            )}
            {profileError && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {profileError}
              </div>
            )}

            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-[#2A2A2A]">
              <div className="relative">
                <div className="size-24 rounded-full bg-[#2A2A2A] flex items-center justify-center overflow-hidden">
                  {user?.userPhotoPath ? (
                    <img src={user.userPhotoPath} alt="Avatar" className="size-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-[#666666]">{user?.userName?.charAt(0)?.toUpperCase() ?? "?"}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 p-1.5 bg-[#D4A574] text-[#0A0A0A] rounded-full hover:bg-[#C4956A] transition-colors"
                >
                  <Camera className="size-4" />
                </button>
              </div>
              <div>
                <p className="font-medium text-[#FAFAFA]">{user?.userName}</p>
                <p className="text-sm text-[#999999]">{user?.userEmail}</p>
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={handleAvatarUpload}
              />
            </div>
            {avatarError && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {avatarError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Email</label>
              <input type="email" value={user?.userEmail ?? ""} disabled className={`${inputClass} bg-[#1E1E1E] text-[#666666]`} />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 300))}
                maxLength={300}
                rows={3}
                placeholder="Tell us about yourself..."
                className={`${inputClass} resize-none`}
              />
              <p className="text-xs text-[#666666] mt-1">{bio.length}/300</p>
            </div>

            <div className="border-t border-[#2A2A2A] pt-4 mt-2">
              <h3 className="text-sm font-semibold text-[#E5E5E5] mb-3">Address</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[#999999] mb-1">Address Line 1</label>
                  <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[#999999] mb-1">Address Line 2</label>
                  <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#999999] mb-1">Suburb / City</label>
                    <input type="text" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-[#999999] mb-1">State / Province</label>
                    <input type="text" value={stateProv} onChange={(e) => setStateProv(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#999999] mb-1">Country</label>
                    <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-[#999999] mb-1">Postcode</label>
                    <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-[#2A2A2A] pt-4 mt-2">
              <h3 className="text-sm font-semibold text-[#E5E5E5] mb-3">Social Media Accounts</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[#999999] mb-1">Facebook</label>
                  <input type="url" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[#999999] mb-1">Instagram</label>
                  <input type="url" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[#999999] mb-1">TikTok</label>
                  <input type="url" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[#999999] mb-1">Pinterest</label>
                  <input type="url" value={pinterest} onChange={(e) => setPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-[#999999] mb-1">LinkedIn</label>
                  <input type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/yourprofile" className={inputClass} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-4 py-2 text-sm font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
              >
                {savingProfile && <Loader2 className="size-4 animate-spin inline mr-1" />}
                Save
              </button>

              <button
                type="button"
                onClick={() => navigate("/mfa-setup")}
                className="px-4 py-2 text-sm font-medium text-[#D4A574] bg-[#D4A574]/10 border border-[#D4A574]/20 rounded-xl hover:bg-[#D4A574]/20 transition-colors flex items-center gap-1"
              >
                <ShieldCheck className="size-4" />
                {user?.mfaEnabled ? "Manage MFA" : "Enable MFA"}
              </button>
            </div>
          </form>
        )}

        {/* Change Password Tab */}
        {activeTab === "password" && (
          <form onSubmit={handleChangePassword} role="tabpanel" id="profile-tabpanel-password" aria-labelledby="profile-tab-password" className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6 space-y-4">
            {passwordMsg && (
              <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                <CheckCircle2 className="size-4 flex-shrink-0" /> {passwordMsg}
              </div>
            )}
            {passwordError && (
              <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {passwordError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Current Password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className={inputClass} />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#E5E5E5] mb-1">New Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className={inputClass} placeholder="Min 8 chars" />
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 text-sm font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
            >
              {savingPassword && <Loader2 className="size-4 animate-spin inline mr-1" />}
              Change Password
            </button>
          </form>
        )}

        {/* Organisation Tab */}
        {activeTab === "kitchen" && (
          <div role="tabpanel" id="profile-tabpanel-kitchen" aria-labelledby="profile-tab-kitchen" className="bg-[#161616] rounded-2xl border border-[#2A2A2A] p-6 space-y-4">
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
                <Loader2 className="size-5 animate-spin text-[#666666]" />
              </div>
            ) : org ? (
              <div>
                {/* Sub-tab navigation */}
                <div className="flex gap-1 mb-4">
                  {([
                    { id: "overview" as const, label: "Overview", Icon: Info },
                    { id: "team" as const, label: "Team", Icon: Users },
                    { id: "locations" as const, label: "Locations", Icon: MapPin },
                  ]).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setOrgSubTab(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                        orgSubTab === id
                          ? "bg-[#D4A574] text-[#0A0A0A] font-medium"
                          : "bg-[#1E1E1E] text-[#999999] hover:bg-[#2A2A2A]"
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
                        <div className="border-t border-[#2A2A2A] pt-3 mt-1">
                          <h4 className="text-sm font-semibold text-[#E5E5E5] mb-3">Social Media Accounts</h4>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">Facebook</label>
                              <input type="url" value={editOrgFacebook} onChange={(e) => setEditOrgFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">Instagram</label>
                              <input type="url" value={editOrgInstagram} onChange={(e) => setEditOrgInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">TikTok</label>
                              <input type="url" value={editOrgTiktok} onChange={(e) => setEditOrgTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">Pinterest</label>
                              <input type="url" value={editOrgPinterest} onChange={(e) => setEditOrgPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                            </div>
                            <div>
                              <label className="block text-xs text-[#999999] mb-1">LinkedIn</label>
                              <input type="url" value={editOrgLinkedin} onChange={(e) => setEditOrgLinkedin(e.target.value)} placeholder="https://linkedin.com/company/yourorg" className={inputClass} />
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" disabled={savingOrg} className="px-4 py-2 text-sm font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 transition-colors">
                            {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                            Save Changes
                          </button>
                          <button type="button" onClick={() => setEditingOrg(false)} className="px-4 py-2 text-sm font-medium text-[#E5E5E5] bg-[#1E1E1E] border border-[#2A2A2A] rounded-xl hover:bg-[#2A2A2A] transition-colors">
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <span className="text-[#999999]">Name:</span>
                            <p className="font-medium text-[#FAFAFA]">{org.organisationName}</p>
                          </div>
                          {org.organisationWebsite && (
                            <div>
                              <span className="text-[#999999]">Website:</span>
                              <p className="font-medium text-[#FAFAFA]">{org.organisationWebsite}</p>
                            </div>
                          )}
                          {org.organisationEmail && (
                            <div>
                              <span className="text-[#999999]">Email:</span>
                              <p className="font-medium text-[#FAFAFA]">{org.organisationEmail}</p>
                            </div>
                          )}
                        </div>

                        {(org.organisationFacebook || org.organisationInstagram || org.organisationTiktok || org.organisationPinterest || org.organisationLinkedin) && (
                          <div className="border-t border-[#2A2A2A] pt-3">
                            <p className="text-xs text-[#999999] mb-2">Social Media</p>
                            <div className="flex flex-wrap gap-2 text-sm">
                              {org.organisationFacebook && <a href={org.organisationFacebook} target="_blank" rel="noopener noreferrer" className="text-[#D4A574] hover:text-[#C4956A] hover:underline">Facebook</a>}
                              {org.organisationInstagram && <a href={org.organisationInstagram} target="_blank" rel="noopener noreferrer" className="text-[#D4A574] hover:text-[#C4956A] hover:underline">Instagram</a>}
                              {org.organisationTiktok && <a href={org.organisationTiktok} target="_blank" rel="noopener noreferrer" className="text-[#D4A574] hover:text-[#C4956A] hover:underline">TikTok</a>}
                              {org.organisationPinterest && <a href={org.organisationPinterest} target="_blank" rel="noopener noreferrer" className="text-[#D4A574] hover:text-[#C4956A] hover:underline">Pinterest</a>}
                              {org.organisationLinkedin && <a href={org.organisationLinkedin} target="_blank" rel="noopener noreferrer" className="text-[#D4A574] hover:text-[#C4956A] hover:underline">LinkedIn</a>}
                            </div>
                          </div>
                        )}

                        {user && myOrgRole === "admin" && (
                          <button type="button" onClick={startEditingOrg} className="text-sm text-[#D4A574] hover:text-[#C4956A] transition-colors">
                            Edit Organisation
                          </button>
                        )}

                        {user && myOrgRole === "admin" && (
                          <OrgBenchBanner orgId={org.organisationId} />
                        )}
                      </>
                    )}

                    {/* Join Key + Leave */}
                    <div className="border-t border-[#2A2A2A] pt-3 space-y-3">
                      <div className="flex items-center gap-2 bg-[#0A0A0A] border border-[#2A2A2A] rounded-lg px-3 py-2">
                        <span className="text-sm text-[#999999]">Org Join Key:</span>
                        <code className="text-sm font-mono font-medium text-[#FAFAFA]">{org.joinKey}</code>
                        <button type="button" onClick={handleCopyKey} className="ml-auto text-[#666666] hover:text-[#E5E5E5] transition-colors" title="Copy join key">
                          {copiedKey ? <CheckCircle2 className="size-4 text-green-500" /> : <Copy className="size-4" />}
                        </button>
                      </div>
                      <button type="button" onClick={handleLeaveOrg} disabled={savingOrg} className="text-sm text-red-400 hover:text-red-300 transition-colors">
                        Leave Organisation
                      </button>
                    </div>

                    {/* ── Kitchen Profile ──────────────────────────── */}
                    <div className="border-t border-[#2A2A2A] pt-4 mt-4">
                      <MyKitchenTab isOrgAdmin={myOrgRole === "admin"} />
                    </div>
                  </div>
                )}

                {/* ── Team sub-tab ────────────────────────────────── */}
                {orgSubTab === "team" && user && (
                  <TeamMembersSection
                    orgId={org.organisationId}
                    currentUserId={user.userId}
                  />
                )}

                {/* ── Locations sub-tab ───────────────────────────── */}
                {orgSubTab === "locations" && user && myOrgRole === "admin" && (
                  <StoreLocationsSection orgId={org.organisationId} />
                )}
                {orgSubTab === "locations" && myOrgRole !== "admin" && (
                  <p className="text-sm text-[#666666] py-4">Only organisation admins can manage store locations.</p>
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
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${orgTab === "create" ? "bg-[#D4A574] text-[#0A0A0A]" : "bg-[#1E1E1E] text-[#999999] hover:bg-[#2A2A2A]"}`}
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
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${orgTab === "join" ? "bg-[#D4A574] text-[#0A0A0A]" : "bg-[#1E1E1E] text-[#999999] hover:bg-[#2A2A2A]"}`}
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

                    <div className="border-t border-[#2A2A2A] pt-3 mt-1">
                      <h4 className="text-sm font-semibold text-[#E5E5E5] mb-3">Social Media Accounts</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-[#999999] mb-1">Facebook</label>
                          <input type="url" value={orgFacebook} onChange={(e) => setOrgFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-[#999999] mb-1">Instagram</label>
                          <input type="url" value={orgInstagram} onChange={(e) => setOrgInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-[#999999] mb-1">TikTok</label>
                          <input type="url" value={orgTiktok} onChange={(e) => setOrgTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-[#999999] mb-1">Pinterest</label>
                          <input type="url" value={orgPinterest} onChange={(e) => setOrgPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-[#999999] mb-1">LinkedIn</label>
                          <input type="url" value={orgLinkedin} onChange={(e) => setOrgLinkedin(e.target.value)} placeholder="https://linkedin.com/company/yourorg" className={inputClass} />
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={savingOrg}
                      className="px-4 py-2 text-sm font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
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
                      className="px-4 py-2 text-sm font-medium text-[#0A0A0A] bg-[#D4A574] rounded-xl hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
                    >
                      {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                      Join Organisation
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {cropImageSrc && (
        <ImageCropModal
          imageSrc={cropImageSrc}
          onCrop={handleCroppedUpload}
          onCancel={() => setCropImageSrc(null)}
        />
      )}
    </div>
  );
}
