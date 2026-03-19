/**
 * @module components/settings/UserDetailPanel
 *
 * Slide-over panel showing detailed user information when an admin clicks
 * a row in the UsersTab. All sections (account, roles, organisation,
 * subscription) are editable. Also provides delete user and send email actions.
 *
 * On mount, fetches the full user profile from GET /api/users/:id, which
 * includes decrypted PII (bio, address, social media) and organisation details.
 *
 * Follows the same overlay pattern as {@link VersionHistory}: fixed
 * right-aligned panel with backdrop, closeable via Escape or backdrop click.
 */

import { useState, useEffect, type FormEvent } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap.js";
import { useAuth } from "../../context/AuthContext.js";
import {
  X,
  User,
  Mail,
  Shield,
  Building2,
  CreditCard,
  Trash2,
  Send,
  Loader2,
  AlertCircle,
  Check,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Pencil,
  LogOut,
  MapPin,
  Share2,
  FileText,
} from "lucide-react";

/** User data shape expected by the panel (same as UsersTab UserRow). */
interface UserRow {
  userId: number;
  userName: string;
  userEmail: string;
  emailVerifiedInd: boolean;
  userPhotoPath: string | null;
  freeSessions: number;
  subscriptionStatus: string;
  subscriptionTier: string;
  userStatus: string;
  createdDttm: string;
  roles: string[];
  organisation: string | null;
}

interface RoleOption {
  roleId: number;
  roleName: string;
}

/** Full profile returned by GET /api/users/:id */
interface FullProfile {
  userBio?: string | null;
  userAddressLine1?: string | null;
  userAddressLine2?: string | null;
  userSuburb?: string | null;
  userState?: string | null;
  userCountry?: string | null;
  userPostcode?: string | null;
  userFacebook?: string | null;
  userInstagram?: string | null;
  userTiktok?: string | null;
  userPinterest?: string | null;
  userLinkedin?: string | null;
}

interface OrgDetails {
  organisationId?: number;
  organisationName?: string;
  organisationEmail?: string | null;
  organisationAddressLine1?: string | null;
  organisationAddressLine2?: string | null;
  organisationSuburb?: string | null;
  organisationState?: string | null;
  organisationCountry?: string | null;
  organisationPostcode?: string | null;
  organisationWebsite?: string | null;
  organisationFacebook?: string | null;
  organisationInstagram?: string | null;
  organisationTiktok?: string | null;
  organisationPinterest?: string | null;
  organisationLinkedin?: string | null;
}

/** Props for {@link UserDetailPanel}. */
interface UserDetailPanelProps {
  /** The user to display. */
  user: UserRow;
  /** Available roles for assignment. */
  availableRoles: RoleOption[];
  /** Called when the panel should close. */
  onClose: () => void;
  /** Called after any change so the parent can refresh. */
  onRefresh: () => void;
}

/**
 * Formats an ISO timestamp into a human-readable date string.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Renders a slide-over panel with detailed user information and admin actions.
 */
export function UserDetailPanel({ user, availableRoles, onClose, onRefresh }: UserDetailPanelProps) {
  const { user: authUser, refreshUser } = useAuth();
  const isEditingSelf = authUser?.userId === user.userId;

  /** Refresh parent list + current user's auth state if editing self. */
  function refreshAll() {
    onRefresh();
    if (isEditingSelf) refreshUser();
  }

  // Full profile fetch (bio, address, social media, org details)
  const [fullProfile, setFullProfile] = useState<FullProfile | null>(null);
  const [orgDetails, setOrgDetails] = useState<OrgDetails | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/users/${user.userId}`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setFullProfile(data.profile ?? null);
          setOrgDetails(data.organisation ?? null);
        }
      } catch {
        // ignore — full profile is supplementary
      } finally {
        setProfileLoading(false);
      }
    })();
  }, [user.userId]);

  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState("");
  const [emailError, setEmailError] = useState("");

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(user.userName);
  const [editEmail, setEditEmail] = useState(user.userEmail);
  const [editStatus, setEditStatus] = useState(user.userStatus);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Subscription editing
  const [editingSub, setEditingSub] = useState(false);
  const [editTier, setEditTier] = useState(user.subscriptionTier);
  const [editSubStatus, setEditSubStatus] = useState(user.subscriptionStatus);
  const [editFreeSessions, setEditFreeSessions] = useState(user.freeSessions);
  const [savingSub, setSavingSub] = useState(false);
  const [subError, setSubError] = useState("");

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [removingOrg, setRemovingOrg] = useState(false);

  const trapRef = useFocusTrap<HTMLDivElement>();

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  /** Save admin edits to user account info. */
  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const res = await fetch(`/api/users/${user.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          userName: editName,
          userEmail: editEmail,
          userStatus: editStatus,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update user");
      }
      setEditing(false);
      refreshAll();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /** Save subscription changes. */
  async function handleSaveSub() {
    setSavingSub(true);
    setSubError("");
    try {
      const subRes = await fetch(`/api/users/${user.userId}/subscription`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subscriptionTier: editTier,
          subscriptionStatus: editSubStatus,
        }),
      });
      if (!subRes.ok) {
        const data = await subRes.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update subscription");
      }

      const sessRes = await fetch(`/api/users/${user.userId}/free-sessions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ freeSessions: editFreeSessions }),
      });
      if (!sessRes.ok) {
        const data = await sessRes.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update free sessions");
      }

      setEditingSub(false);
      refreshAll();
    } catch (err) {
      setSubError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingSub(false);
    }
  }

  /** Assign a role to the user. */
  async function handleAssignRole(roleId: number) {
    await fetch(`/api/users/${user.userId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ roleId }),
    });
    refreshAll();
  }

  /** Remove a role from the user. */
  async function handleRemoveRole(roleName: string) {
    const r = availableRoles.find((role) => role.roleName === roleName);
    if (!r) return;
    await fetch(`/api/users/${user.userId}/roles/${r.roleId}`, {
      method: "DELETE",
      credentials: "include",
    });
    refreshAll();
  }

  /** Remove user from their organisation. */
  async function handleRemoveOrg() {
    setRemovingOrg(true);
    try {
      await fetch(`/api/users/${user.userId}/organisation`, {
        method: "DELETE",
        credentials: "include",
      });
      refreshAll();
    } finally {
      setRemovingOrg(false);
    }
  }

  /** Send a direct email to this user. */
  async function handleSendEmail(e: FormEvent) {
    e.preventDefault();
    setSendingEmail(true);
    setEmailError("");
    setEmailSuccess("");

    try {
      const res = await fetch(`/api/users/${user.userId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subject: emailSubject, body: emailBody }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send email");
      }

      setEmailSuccess("Email sent successfully");
      setEmailSubject("");
      setEmailBody("");
      setShowEmailForm(false);
      setTimeout(() => setEmailSuccess(""), 3000);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSendingEmail(false);
    }
  }

  /** Delete this user permanently. */
  async function handleDelete() {
    setDeleting(true);
    setDeleteError("");

    try {
      const res = await fetch(`/api/users/${user.userId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete user");
      }

      refreshAll();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  const statusColors: Record<string, string> = {
    active: "bg-green-900/40 text-green-400",
    suspended: "bg-yellow-900/40 text-yellow-400",
    cancelled: "bg-red-900/40 text-red-400",
  };

  const initials = user.userName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const unassignedRoles = availableRoles.filter(
    (r) => !user.roles.includes(r.roleName)
  );

  /** Build a comma-joined address string from available parts. */
  function formatAddress(p: FullProfile) {
    return [
      p.userAddressLine1,
      p.userAddressLine2,
      p.userSuburb,
      p.userState,
      p.userCountry,
      p.userPostcode,
    ]
      .filter(Boolean)
      .join(", ");
  }

  /** Build a comma-joined org address string. */
  function formatOrgAddress(o: OrgDetails) {
    return [
      o.organisationAddressLine1,
      o.organisationAddressLine2,
      o.organisationSuburb,
      o.organisationState,
      o.organisationCountry,
      o.organisationPostcode,
    ]
      .filter(Boolean)
      .join(", ");
  }

  const socialLabels: { key: keyof FullProfile; label: string }[] = [
    { key: "userFacebook", label: "Facebook" },
    { key: "userInstagram", label: "Instagram" },
    { key: "userTiktok", label: "TikTok" },
    { key: "userPinterest", label: "Pinterest" },
    { key: "userLinkedin", label: "LinkedIn" },
  ];

  const orgSocialLabels: { key: keyof OrgDetails; label: string }[] = [
    { key: "organisationFacebook", label: "Facebook" },
    { key: "organisationInstagram", label: "Instagram" },
    { key: "organisationTiktok", label: "TikTok" },
    { key: "organisationPinterest", label: "Pinterest" },
    { key: "organisationLinkedin", label: "LinkedIn" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" ref={trapRef} role="dialog" aria-modal="true" aria-label={`User details: ${user.userName}`}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-[#161616] shadow-2xl shadow-black/40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2A2A2A]">
          <div className="flex items-center gap-3">
            {user.userPhotoPath ? (
              <img src={user.userPhotoPath} alt="" className="size-10 rounded-full object-cover" />
            ) : (
              <div className="size-10 rounded-full bg-[#D4A574]/15 flex items-center justify-center text-sm font-semibold text-[#D4A574]">
                {initials}
              </div>
            )}
            <div>
              <h2 className="text-lg font-semibold text-[#FAFAFA]">{user.userName}</h2>
              <p className="text-sm text-[#999999]">{user.userEmail}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#999999] hover:text-[#E5E5E5] transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Account Info */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <User className="size-4 text-[#999999]" />
              <h3 className="text-sm font-semibold text-[#E5E5E5] uppercase tracking-wider">Account</h3>
              {!editing && (
                <button
                  onClick={() => {
                    setEditName(user.userName);
                    setEditEmail(user.userEmail);
                    setEditStatus(user.userStatus);
                    setSaveError("");
                    setEditing(true);
                  }}
                  className="ml-auto p-1 text-[#999999] hover:text-[#D4A574] transition-colors"
                  title="Edit account details"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
            <div className="pl-6 space-y-1.5">
              {saveError && (
                <div className="flex items-center gap-2 text-sm text-red-400 mb-1">
                  <AlertCircle className="size-4" /> {saveError}
                </div>
              )}

              {editing ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#999999]">Name</span>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-48 rounded-lg border border-[#2A2A2A] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#999999]">Email</span>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-48 rounded-lg border border-[#2A2A2A] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#999999]">Status</span>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="w-48 rounded-lg border border-[#2A2A2A] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                    >
                      <option value="active">active</option>
                      <option value="suspended">suspended</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
                    >
                      {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditing(false);
                        setSaveError("");
                      }}
                      className="px-3 py-1.5 text-sm text-[#E5E5E5] hover:text-[#FAFAFA] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <InfoRow label="Status">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusColors[user.userStatus] ?? "bg-[#1E1E1E] text-[#E5E5E5]"}`}>
                      {user.userStatus}
                    </span>
                  </InfoRow>
                  <InfoRow label="Email Verified">
                    {user.emailVerifiedInd ? (
                      <span className="flex items-center gap-1 text-sm text-green-400">
                        <CheckCircle2 className="size-3.5" /> Verified
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-sm text-red-500">
                        <XCircle className="size-3.5" /> Unverified
                      </span>
                    )}
                  </InfoRow>
                  <InfoRow label="Joined">{formatDate(user.createdDttm)}</InfoRow>
                </>
              )}
            </div>
          </div>

          {/* Profile (bio + address + social) — loaded async */}
          {profileLoading ? (
            <div className="flex items-center gap-2 text-sm text-[#999999]">
              <Loader2 className="size-4 animate-spin" /> Loading profile…
            </div>
          ) : fullProfile && (
            <>
              {/* Bio */}
              {fullProfile.userBio && (
                <Section icon={FileText} title="Bio">
                  <p className="text-sm text-[#E5E5E5] leading-relaxed">{fullProfile.userBio}</p>
                </Section>
              )}

              {/* Address */}
              {(fullProfile.userAddressLine1 || fullProfile.userSuburb || fullProfile.userCountry) && (
                <Section icon={MapPin} title="Address">
                  <p className="text-sm text-[#E5E5E5]">{formatAddress(fullProfile)}</p>
                </Section>
              )}

              {/* Social Media */}
              {socialLabels.some(({ key }) => fullProfile[key]) && (
                <Section icon={Share2} title="Social Media">
                  {socialLabels
                    .filter(({ key }) => fullProfile[key])
                    .map(({ key, label }) => (
                      <InfoRow key={key} label={label}>
                        <a
                          href={fullProfile[key] as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-[#D4A574] hover:underline truncate max-w-[200px] block"
                        >
                          {fullProfile[key] as string}
                        </a>
                      </InfoRow>
                    ))}
                </Section>
              )}
            </>
          )}

          {/* Roles — editable inline */}
          <Section icon={Shield} title="Roles">
            <div className="flex flex-wrap gap-1.5">
              {user.roles.length > 0 ? (
                user.roles.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-[#D4A574]/10 text-[#D4A574] border border-[#D4A574]/20 cursor-pointer hover:bg-red-900/40 hover:text-red-400 hover:border-red-700/40 transition-colors"
                    title={`Click to remove ${r}`}
                    onClick={() => handleRemoveRole(r)}
                  >
                    {r}
                    <XCircle className="size-3" />
                  </span>
                ))
              ) : (
                <span className="text-sm text-[#999999] italic">No roles assigned</span>
              )}
              {unassignedRoles.length > 0 && (
                <select
                  className="text-xs border border-[#2A2A2A] rounded px-1.5 py-0.5 text-[#999999]"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleAssignRole(parseInt(e.target.value));
                  }}
                >
                  <option value="">+ Add role</option>
                  {unassignedRoles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.roleName}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </Section>

          {/* Organisation — name + full details */}
          <Section icon={Building2} title="Organisation">
            {user.organisation ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#E5E5E5]">{user.organisation}</p>
                  <button
                    onClick={handleRemoveOrg}
                    disabled={removingOrg}
                    className="flex items-center gap-1 text-xs text-red-500 hover:text-red-400 transition-colors"
                    title="Remove from organisation"
                  >
                    {removingOrg ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <LogOut className="size-3" />
                    )}
                    Remove
                  </button>
                </div>
                {orgDetails && (
                  <div className="space-y-1">
                    {orgDetails.organisationEmail && (
                      <InfoRow label="Email">{orgDetails.organisationEmail}</InfoRow>
                    )}
                    {orgDetails.organisationWebsite && (
                      <InfoRow label="Website">
                        <a
                          href={orgDetails.organisationWebsite}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#D4A574] hover:underline text-sm truncate max-w-[200px] block"
                        >
                          {orgDetails.organisationWebsite}
                        </a>
                      </InfoRow>
                    )}
                    {(orgDetails.organisationAddressLine1 || orgDetails.organisationSuburb) && (
                      <InfoRow label="Address">
                        <span className="text-sm text-[#E5E5E5]">{formatOrgAddress(orgDetails)}</span>
                      </InfoRow>
                    )}
                    {orgSocialLabels.some(({ key }) => orgDetails[key]) && (
                      <div className="pt-1 space-y-1">
                        {orgSocialLabels
                          .filter(({ key }) => orgDetails[key])
                          .map(({ key, label }) => (
                            <InfoRow key={key} label={label}>
                              <a
                                href={orgDetails[key] as string}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-[#D4A574] hover:underline truncate max-w-[200px] block"
                              >
                                {orgDetails[key] as string}
                              </a>
                            </InfoRow>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[#999999] italic">Not a member of any organisation</p>
            )}
          </Section>

          {/* Subscription — editable */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="size-4 text-[#999999]" />
              <h3 className="text-sm font-semibold text-[#E5E5E5] uppercase tracking-wider">Subscription</h3>
              {!editingSub && (
                <button
                  onClick={() => {
                    setEditTier(user.subscriptionTier);
                    setEditSubStatus(user.subscriptionStatus);
                    setEditFreeSessions(user.freeSessions);
                    setSubError("");
                    setEditingSub(true);
                  }}
                  className="ml-auto p-1 text-[#999999] hover:text-[#D4A574] transition-colors"
                  title="Edit subscription"
                >
                  <Pencil className="size-3.5" />
                </button>
              )}
            </div>
            <div className="pl-6 space-y-1.5">
              {subError && (
                <div className="flex items-center gap-2 text-sm text-red-400 mb-1">
                  <AlertCircle className="size-4" /> {subError}
                </div>
              )}

              {editingSub ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#999999]">Tier</span>
                    <select
                      value={editTier}
                      onChange={(e) => setEditTier(e.target.value)}
                      className="w-48 rounded-lg border border-[#2A2A2A] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                    >
                      <option value="free">free</option>
                      <option value="starter">starter</option>
                      <option value="professional">professional</option>
                      <option value="enterprise">enterprise</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#999999]">Status</span>
                    <select
                      value={editSubStatus}
                      onChange={(e) => setEditSubStatus(e.target.value)}
                      className="w-48 rounded-lg border border-[#2A2A2A] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                    >
                      <option value="active">active</option>
                      <option value="cancelled">cancelled</option>
                      <option value="past_due">past_due</option>
                      <option value="trialing">trialing</option>
                      <option value="none">none</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[#999999]">Free Sessions</span>
                    <input
                      type="number"
                      min={0}
                      value={editFreeSessions}
                      onChange={(e) => setEditFreeSessions(parseInt(e.target.value) || 0)}
                      className="w-48 rounded-lg border border-[#2A2A2A] px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-2">
                    <button
                      onClick={handleSaveSub}
                      disabled={savingSub}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
                    >
                      {savingSub ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingSub(false);
                        setSubError("");
                      }}
                      className="px-3 py-1.5 text-sm text-[#E5E5E5] hover:text-[#FAFAFA] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <InfoRow label="Tier">{user.subscriptionTier}</InfoRow>
                  <InfoRow label="Status">{user.subscriptionStatus}</InfoRow>
                  <InfoRow label="Free Sessions">{user.freeSessions}</InfoRow>
                </>
              )}
            </div>
          </div>

          {/* Send Email */}
          <Section icon={Mail} title="Send Email">
            {emailSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-400 mb-2">
                <Check className="size-4" /> {emailSuccess}
              </div>
            )}
            <button
              onClick={() => setShowEmailForm(!showEmailForm)}
              className="flex items-center gap-1.5 text-sm text-[#D4A574] hover:text-[#D4A574] font-medium transition-colors"
            >
              {showEmailForm ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {showEmailForm ? "Hide" : "Compose Email"}
            </button>

            {showEmailForm && (
              <form onSubmit={handleSendEmail} className="mt-3 space-y-3">
                {emailError && (
                  <div className="flex items-center gap-2 text-sm text-red-400">
                    <AlertCircle className="size-4" /> {emailError}
                  </div>
                )}
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Subject"
                  required
                  className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                />
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder="Email body (HTML supported)"
                  required
                  rows={4}
                  className="w-full rounded-lg border border-[#2A2A2A] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#D4A574]/50"
                />
                <button
                  type="submit"
                  disabled={sendingEmail}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 transition-colors"
                >
                  {sendingEmail ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send Email
                </button>
              </form>
            )}
          </Section>

          {/* Delete User */}
          <div className="border-t border-[#2A2A2A] pt-4">
            {deleteError && (
              <div className="flex items-center gap-2 text-sm text-red-400 mb-3">
                <AlertCircle className="size-4" /> {deleteError}
              </div>
            )}

            {showDeleteConfirm ? (
              <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-4 space-y-3">
                <p className="text-sm text-red-400 font-medium">
                  Permanently delete {user.userName}?
                </p>
                <p className="text-xs text-red-400">
                  This will remove all messages, conversations, roles, and associated data. This action cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    Delete Permanently
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 text-sm text-[#E5E5E5] hover:text-[#FAFAFA] transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 text-sm text-red-500 hover:text-red-400 font-medium transition-colors"
              >
                <Trash2 className="size-4" />
                Delete User
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

/** Section with icon and title. */
function Section({ icon: Icon, title, children }: {
  icon: typeof User;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-4 text-[#999999]" />
        <h3 className="text-sm font-semibold text-[#E5E5E5] uppercase tracking-wider">{title}</h3>
      </div>
      <div className="pl-6 space-y-1.5">{children}</div>
    </div>
  );
}

/** Label-value info row. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#999999]">{label}</span>
      <span className="text-sm text-[#FAFAFA]">{children}</span>
    </div>
  );
}
