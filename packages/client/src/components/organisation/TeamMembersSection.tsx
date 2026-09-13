/**
 * @module components/organisation/TeamMembersSection
 *
 * Org-scoped member list: view, promote/demote, remove. Relocated from
 * ProfilePage.tsx's nested Profile → Team sub-tab to Organisation Settings
 * (Profile menu → Organisation) — same component, same three API calls,
 * only the home changed.
 */

import { useState, useEffect } from "react";
import { Users, Loader2, AlertCircle } from "lucide-react";

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

export function TeamMembersSection({ orgId, currentUserId }: { orgId: number; currentUserId: number }) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Org admin per the per-org flag ONLY — matches the server's
  // isOrgManager() in organisationController.ts, which deliberately does not
  // fall back to the global org:manage-organisation permission (that
  // permission isn't scoped to a single org, so it must never be treated as
  // "admin of this specific org").
  const isOrgAdmin = members.some((m) => m.userId === currentUserId && m.role === "admin");

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
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Users className="size-4 text-dark-600" />
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
          <Loader2 className="size-5 animate-spin text-dark-500" />
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-dark-500 italic">No members found.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => {
            const isSelf = m.userId === currentUserId;
            const initial = (m.displayName ?? "?").charAt(0).toUpperCase();
            return (
              <div
                key={m.userId}
                className="flex items-center gap-3 rounded-xl border border-dark-200 bg-dark-100 px-3 py-2.5"
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
                      <span className="text-xs text-dark-500">(You)</span>
                    )}
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        m.role === "admin"
                          ? "bg-gold/15 text-gold"
                          : "bg-dark-100 text-dark-600"
                      }`}
                    >
                      {m.role === "admin" ? "Admin" : "Member"}
                    </span>
                  </div>
                  {m.bio && (
                    <p className="text-xs text-dark-500 truncate mt-0.5">
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
                      className="text-xs text-gold hover:text-gold-hover font-medium transition-colors"
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
