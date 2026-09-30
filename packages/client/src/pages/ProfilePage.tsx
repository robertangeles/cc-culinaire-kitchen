/**
 * @module pages/ProfilePage
 *
 * User profile page with editable name, password change,
 * and organisation create/join functionality.
 */

import { useState, useEffect, useRef, type FormEvent, type ElementType, type KeyboardEvent } from "react";
import {
  User,
  ShieldCheck,
  UtensilsCrossed,
  FileText,
} from "lucide-react";
import { AccountTab } from "../components/profile/AccountTab.js";
import { SecurityTab } from "../components/profile/SecurityTab.js";
import { OrgTab } from "../components/profile/OrgTab.js";
import { MyDocumentsTab } from "../components/compliance/MyDocumentsTab.js";
import { ImageCropModal } from "../components/ui/ImageCropModal.js";
import { useAuth } from "../context/AuthContext.js";
import { useHasPermission } from "../hooks/useHasPermission.js";

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const hasPermission = useHasPermission();

  const tabs: { id: "account" | "security" | "kitchen" | "documents"; label: string; Icon: ElementType }[] = [
    { id: "account", label: "Account Details", Icon: User },
    { id: "security", label: "Security", Icon: ShieldCheck },
    { id: "kitchen", label: "Profile", Icon: UtensilsCrossed },
  ];
  if (hasPermission("compliance:read-own")) {
    tabs.push({ id: "documents", label: "My Documents", Icon: FileText });
  }
  const [activeTab, setActiveTab] = useState<"account" | "security" | "kitchen" | "documents">("account");

  // Profile state (kept here for autosave-on-tab-switch dirty check)
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

  // Avatar state
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

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError("");
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

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-dark">
      {/* Was max-w-2xl (42rem/672px). 25% wider is 840px = 52.5rem, which has
          no Tailwind preset (max-w-3xl is only +14%, max-w-4xl is +33%), hence
          the arbitrary value. */}
      <div className="max-w-[52.5rem] mx-auto space-y-6">
        <h1 className="text-xl font-bold text-[#FAFAFA]">Profile</h1>

        {/* Tab Bar */}
        <div role="tablist" aria-label="Profile" className="flex gap-1 bg-dark-50 rounded-xl p-1 border border-dark-200">
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
                  ? "bg-gold text-dark"
                  : "text-dark-600 hover:text-[#E5E5E5]"
              }`}
            >
              <tab.Icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "account" && (
          <AccountTab
            user={user}
            name={name} setName={setName}
            bio={bio} setBio={setBio}
            addressLine1={addressLine1} setAddressLine1={setAddressLine1}
            addressLine2={addressLine2} setAddressLine2={setAddressLine2}
            suburb={suburb} setSuburb={setSuburb}
            stateProv={stateProv} setStateProv={setStateProv}
            country={country} setCountry={setCountry}
            postcode={postcode} setPostcode={setPostcode}
            facebook={facebook} setFacebook={setFacebook}
            instagram={instagram} setInstagram={setInstagram}
            tiktok={tiktok} setTiktok={setTiktok}
            pinterest={pinterest} setPinterest={setPinterest}
            linkedin={linkedin} setLinkedin={setLinkedin}
            profileMsg={profileMsg}
            profileError={profileError}
            savingProfile={savingProfile}
            handleSaveProfile={handleSaveProfile}
            avatarInputRef={avatarInputRef}
            avatarError={avatarError}
            handleAvatarUpload={handleAvatarUpload}
          />
        )}

        {activeTab === "security" && <SecurityTab />}

        <div className={activeTab !== "kitchen" ? "hidden" : ""}>
          <OrgTab />
        </div>

        {activeTab === "documents" && (
          <div role="tabpanel" id="profile-tabpanel-documents" aria-labelledby="profile-tab-documents" className="bg-dark-50 rounded-2xl border border-dark-200 p-6">
            <MyDocumentsTab />
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
