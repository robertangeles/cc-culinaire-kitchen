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
  Building2,
  Key,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  ShieldCheck,
  Camera,
  UtensilsCrossed,
} from "lucide-react";
import { MyKitchenTab } from "../components/profile/MyKitchenTab.js";
import { useAuth } from "../context/AuthContext.js";
import { ImageCropModal } from "../components/ui/ImageCropModal.js";

const tabs: { id: "account" | "password" | "organisation" | "kitchen"; label: string; Icon: ElementType }[] = [
  { id: "account", label: "Account Details", Icon: User },
  { id: "password", label: "Change Password", Icon: Key },
  { id: "organisation", label: "Organisation", Icon: Building2 },
  { id: "kitchen", label: "My Kitchen", Icon: UtensilsCrossed },
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

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  // Tabs
  const [activeTab, setActiveTab] = useState<"account" | "password" | "organisation" | "kitchen">("account");

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
  const [orgTab, setOrgTab] = useState<"create" | "join">("create");
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
          setOrg(data.organisation);
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
    "w-full rounded-lg border border-stone-300 px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent";

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="text-xl font-bold text-stone-800">Profile</h1>

        {/* Tab Bar */}
        <div role="tablist" aria-label="Profile" className="flex gap-1 bg-stone-100 rounded-xl p-1">
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
                  ? "bg-white text-stone-800 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              <tab.Icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Account Details Tab */}
        {activeTab === "account" && (
          <form onSubmit={handleSaveProfile} role="tabpanel" id="profile-tabpanel-account" aria-labelledby="profile-tab-account" className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
            {profileMsg && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="size-4 flex-shrink-0" /> {profileMsg}
              </div>
            )}
            {profileError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {profileError}
              </div>
            )}

            <div className="flex items-center gap-4 mb-6 pb-6 border-b border-stone-200">
              <div className="relative">
                <div className="size-24 rounded-full bg-stone-200 flex items-center justify-center overflow-hidden">
                  {user?.userPhotoPath ? (
                    <img src={user.userPhotoPath} alt="Avatar" className="size-full object-cover" />
                  ) : (
                    <span className="text-2xl font-bold text-stone-400">{user?.userName?.charAt(0)?.toUpperCase() ?? "?"}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 p-1.5 bg-amber-600 text-white rounded-full hover:bg-amber-700 transition-colors"
                >
                  <Camera className="size-4" />
                </button>
              </div>
              <div>
                <p className="font-medium text-stone-800">{user?.userName}</p>
                <p className="text-sm text-stone-500">{user?.userEmail}</p>
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
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {avatarError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
              <input type="email" value={user?.userEmail ?? ""} disabled className={`${inputClass} bg-stone-50`} />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={inputClass} />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value.slice(0, 300))}
                maxLength={300}
                rows={3}
                placeholder="Tell us about yourself..."
                className={`${inputClass} resize-none`}
              />
              <p className="text-xs text-stone-400 mt-1">{bio.length}/300</p>
            </div>

            <div className="border-t border-stone-200 pt-4 mt-2">
              <h3 className="text-sm font-semibold text-stone-700 mb-3">Address</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Address Line 1</label>
                  <input type="text" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Address Line 2</label>
                  <input type="text" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className={inputClass} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Suburb / City</label>
                    <input type="text" value={suburb} onChange={(e) => setSuburb(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">State / Province</label>
                    <input type="text" value={stateProv} onChange={(e) => setStateProv(e.target.value)} className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Country</label>
                    <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} className={inputClass} />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">Postcode</label>
                    <input type="text" value={postcode} onChange={(e) => setPostcode(e.target.value)} className={inputClass} />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-stone-200 pt-4 mt-2">
              <h3 className="text-sm font-semibold text-stone-700 mb-3">Social Media Accounts</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Facebook</label>
                  <input type="url" value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Instagram</label>
                  <input type="url" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">TikTok</label>
                  <input type="url" value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">Pinterest</label>
                  <input type="url" value={pinterest} onChange={(e) => setPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">LinkedIn</label>
                  <input type="url" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/yourprofile" className={inputClass} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={savingProfile}
                className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {savingProfile && <Loader2 className="size-4 animate-spin inline mr-1" />}
                Save
              </button>

              <button
                type="button"
                onClick={() => navigate("/mfa-setup")}
                className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1"
              >
                <ShieldCheck className="size-4" />
                {user?.mfaEnabled ? "Manage MFA" : "Enable MFA"}
              </button>
            </div>
          </form>
        )}

        {/* Change Password Tab */}
        {activeTab === "password" && (
          <form onSubmit={handleChangePassword} role="tabpanel" id="profile-tabpanel-password" aria-labelledby="profile-tab-password" className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
            {passwordMsg && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="size-4 flex-shrink-0" /> {passwordMsg}
              </div>
            )}
            {passwordError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {passwordError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Current Password</label>
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className={inputClass} />
            </div>

            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">New Password</label>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className={inputClass} placeholder="Min 8 chars" />
            </div>

            <button
              type="submit"
              disabled={savingPassword}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              {savingPassword && <Loader2 className="size-4 animate-spin inline mr-1" />}
              Change Password
            </button>
          </form>
        )}

        {/* Organisation Tab */}
        {activeTab === "organisation" && (
          <div role="tabpanel" id="profile-tabpanel-organisation" aria-labelledby="profile-tab-organisation" className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
            {orgMsg && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="size-4 flex-shrink-0" /> {orgMsg}
              </div>
            )}
            {orgError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertCircle className="size-4 flex-shrink-0" /> {orgError}
              </div>
            )}

            {orgLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-5 animate-spin text-stone-400" />
              </div>
            ) : org ? (
              <div className="space-y-3">
                {user && org.createdBy === user.userId && editingOrg ? (
                  <form onSubmit={handleUpdateOrg} className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Organisation Name *</label>
                      <input type="text" value={editOrgName} onChange={(e) => setEditOrgName(e.target.value)} required className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Address Line 1</label>
                      <input type="text" value={editOrgAddressLine1} onChange={(e) => setEditOrgAddressLine1(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Address Line 2</label>
                      <input type="text" value={editOrgAddressLine2} onChange={(e) => setEditOrgAddressLine2(e.target.value)} className={inputClass} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Suburb / City</label>
                        <input type="text" value={editOrgSuburb} onChange={(e) => setEditOrgSuburb(e.target.value)} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">State / Province</label>
                        <input type="text" value={editOrgStateProv} onChange={(e) => setEditOrgStateProv(e.target.value)} className={inputClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Country</label>
                        <input type="text" value={editOrgCountry} onChange={(e) => setEditOrgCountry(e.target.value)} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Postcode</label>
                        <input type="text" value={editOrgPostcode} onChange={(e) => setEditOrgPostcode(e.target.value)} className={inputClass} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Website</label>
                      <input type="text" value={editOrgWebsite} onChange={(e) => setEditOrgWebsite(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
                      <input type="email" value={editOrgEmail} onChange={(e) => setEditOrgEmail(e.target.value)} className={inputClass} />
                    </div>

                    <div className="border-t border-stone-200 pt-3 mt-1">
                      <h4 className="text-sm font-semibold text-stone-700 mb-3">Social Media Accounts</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">Facebook</label>
                          <input type="url" value={editOrgFacebook} onChange={(e) => setEditOrgFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">Instagram</label>
                          <input type="url" value={editOrgInstagram} onChange={(e) => setEditOrgInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">TikTok</label>
                          <input type="url" value={editOrgTiktok} onChange={(e) => setEditOrgTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">Pinterest</label>
                          <input type="url" value={editOrgPinterest} onChange={(e) => setEditOrgPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">LinkedIn</label>
                          <input type="url" value={editOrgLinkedin} onChange={(e) => setEditOrgLinkedin(e.target.value)} placeholder="https://linkedin.com/company/yourorg" className={inputClass} />
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={savingOrg}
                        className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                      >
                        {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                        Save Changes
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingOrg(false)}
                        className="px-4 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span className="text-stone-500">Name:</span>
                        <p className="font-medium text-stone-800">{org.organisationName}</p>
                      </div>
                      {org.organisationAddressLine1 && (
                        <div className="col-span-2">
                          <span className="text-stone-500">Address:</span>
                          <p className="font-medium text-stone-800">
                            {[org.organisationAddressLine1, org.organisationAddressLine2].filter(Boolean).join(", ")}
                            {org.organisationSuburb && <><br />{[org.organisationSuburb, org.organisationState, org.organisationPostcode].filter(Boolean).join(" ")}</>}
                            {org.organisationCountry && <><br />{org.organisationCountry}</>}
                          </p>
                        </div>
                      )}
                      {org.organisationWebsite && (
                        <div>
                          <span className="text-stone-500">Website:</span>
                          <p className="font-medium text-stone-800">{org.organisationWebsite}</p>
                        </div>
                      )}
                      {org.organisationEmail && (
                        <div>
                          <span className="text-stone-500">Email:</span>
                          <p className="font-medium text-stone-800">{org.organisationEmail}</p>
                        </div>
                      )}
                    </div>

                    {(org.organisationFacebook || org.organisationInstagram || org.organisationTiktok || org.organisationPinterest || org.organisationLinkedin) && (
                      <div className="border-t border-stone-100 pt-3">
                        <p className="text-xs text-stone-500 mb-2">Social Media</p>
                        <div className="flex flex-wrap gap-2 text-sm">
                          {org.organisationFacebook && <a href={org.organisationFacebook} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">Facebook</a>}
                          {org.organisationInstagram && <a href={org.organisationInstagram} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">Instagram</a>}
                          {org.organisationTiktok && <a href={org.organisationTiktok} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">TikTok</a>}
                          {org.organisationPinterest && <a href={org.organisationPinterest} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">Pinterest</a>}
                          {org.organisationLinkedin && <a href={org.organisationLinkedin} target="_blank" rel="noopener noreferrer" className="text-amber-600 hover:underline">LinkedIn</a>}
                        </div>
                      </div>
                    )}

                    {user && org.createdBy === user.userId && (
                      <button
                        type="button"
                        onClick={startEditingOrg}
                        className="text-sm text-amber-600 hover:text-amber-700 transition-colors"
                      >
                        Edit Organisation
                      </button>
                    )}
                  </>
                )}

                <div className="flex items-center gap-2 bg-stone-50 rounded-lg px-3 py-2">
                  <span className="text-sm text-stone-500">Join Key:</span>
                  <code className="text-sm font-mono font-medium text-stone-800">{org.joinKey}</code>
                  <button
                    type="button"
                    onClick={handleCopyKey}
                    className="ml-auto text-stone-400 hover:text-stone-600 transition-colors"
                    title="Copy join key"
                  >
                    {copiedKey ? <CheckCircle2 className="size-4 text-green-500" /> : <Copy className="size-4" />}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleLeaveOrg}
                  disabled={savingOrg}
                  className="text-sm text-red-600 hover:text-red-700 transition-colors"
                >
                  Leave Organisation
                </button>
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
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${orgTab === "create" ? "bg-amber-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
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
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${orgTab === "join" ? "bg-amber-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                  >
                    Join
                  </button>
                </div>

                {orgTab === "create" ? (
                  <form onSubmit={handleCreateOrg} role="tabpanel" id="org-tabpanel-create" aria-labelledby="org-tab-create" className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Organisation Name *</label>
                      <input type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)} required className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Address Line 1</label>
                      <input type="text" value={orgAddressLine1} onChange={(e) => setOrgAddressLine1(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Address Line 2</label>
                      <input type="text" value={orgAddressLine2} onChange={(e) => setOrgAddressLine2(e.target.value)} className={inputClass} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Suburb / City</label>
                        <input type="text" value={orgSuburb} onChange={(e) => setOrgSuburb(e.target.value)} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">State / Province</label>
                        <input type="text" value={orgStateProv} onChange={(e) => setOrgStateProv(e.target.value)} className={inputClass} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Country</label>
                        <input type="text" value={orgCountry} onChange={(e) => setOrgCountry(e.target.value)} className={inputClass} />
                      </div>
                      <div>
                        <label className="block text-xs text-stone-500 mb-1">Postcode</label>
                        <input type="text" value={orgPostcode} onChange={(e) => setOrgPostcode(e.target.value)} className={inputClass} />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Website</label>
                      <input type="text" value={orgWebsite} onChange={(e) => setOrgWebsite(e.target.value)} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
                      <input type="email" value={orgEmail} onChange={(e) => setOrgEmail(e.target.value)} className={inputClass} />
                    </div>

                    <div className="border-t border-stone-200 pt-3 mt-1">
                      <h4 className="text-sm font-semibold text-stone-700 mb-3">Social Media Accounts</h4>
                      <div className="space-y-3">
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">Facebook</label>
                          <input type="url" value={orgFacebook} onChange={(e) => setOrgFacebook(e.target.value)} placeholder="https://facebook.com/yourpage" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">Instagram</label>
                          <input type="url" value={orgInstagram} onChange={(e) => setOrgInstagram(e.target.value)} placeholder="https://instagram.com/yourhandle" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">TikTok</label>
                          <input type="url" value={orgTiktok} onChange={(e) => setOrgTiktok(e.target.value)} placeholder="https://tiktok.com/@yourhandle" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">Pinterest</label>
                          <input type="url" value={orgPinterest} onChange={(e) => setOrgPinterest(e.target.value)} placeholder="https://pinterest.com/yourpage" className={inputClass} />
                        </div>
                        <div>
                          <label className="block text-xs text-stone-500 mb-1">LinkedIn</label>
                          <input type="url" value={orgLinkedin} onChange={(e) => setOrgLinkedin(e.target.value)} placeholder="https://linkedin.com/company/yourorg" className={inputClass} />
                        </div>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={savingOrg}
                      className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      {savingOrg && <Loader2 className="size-4 animate-spin inline mr-1" />}
                      Create Organisation
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleJoinOrg} role="tabpanel" id="org-tabpanel-join" aria-labelledby="org-tab-join" className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">Join Key</label>
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
                      className="px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
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

        {/* My Kitchen Tab */}
        {activeTab === "kitchen" && (
          <div role="tabpanel" id="profile-tabpanel-kitchen" aria-labelledby="profile-tab-kitchen">
            <MyKitchenTab />
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
