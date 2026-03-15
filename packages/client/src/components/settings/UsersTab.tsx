/**
 * @module components/settings/UsersTab
 *
 * Admin user management: searchable user table with actions for
 * suspending, cancelling, editing free sessions, and assigning roles.
 * Clicking a user row opens a {@link UserDetailPanel} slide-over
 * with full details and admin actions (delete, send email).
 */

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Loader2,
  UserX,
  UserCheck,
  Ban,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { UserDetailPanel } from "./UserDetailPanel.js";
import { PersonalisationTab } from "./PersonalisationTab.js";

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

export function UsersTab() {
  const [subTab, setSubTab] = useState<"users" | "personalisation">("users");

  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [editingSessions, setEditingSessions] = useState<number | null>(null);
  const [sessionValue, setSessionValue] = useState(0);
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);

  const limit = 15;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) params.set("search", search);
      const res = await fetch(`/api/users?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        setTotal(data.total);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/roles", { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setRoles(data.roles.map((r: { roleId: number; roleName: string }) => ({
            roleId: r.roleId,
            roleName: r.roleName,
          })));
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  async function handleAction(userId: number, action: string) {
    await fetch(`/api/users/${userId}/${action}`, {
      method: "PATCH",
      credentials: "include",
    });
    fetchUsers();
  }

  async function handleSaveSessions(userId: number) {
    await fetch(`/api/users/${userId}/free-sessions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ freeSessions: sessionValue }),
    });
    setEditingSessions(null);
    fetchUsers();
  }

  async function handleAssignRole(userId: number, roleId: number) {
    await fetch(`/api/users/${userId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ roleId }),
    });
    fetchUsers();
  }

  async function handleRemoveRole(userId: number, roleName: string) {
    const r = roles.find((role) => role.roleName === roleName);
    if (!r) return;
    await fetch(`/api/users/${userId}/roles/${r.roleId}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchUsers();
  }

  const totalPages = Math.ceil(total / limit);

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: "bg-green-100 text-green-700",
      suspended: "bg-yellow-100 text-yellow-700",
      cancelled: "bg-red-100 text-red-700",
    };
    return (
      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "bg-stone-100 text-stone-600"}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tab bar */}
      <div className="flex gap-1 px-6 pt-5 pb-0 border-b border-stone-200">
        <button
          onClick={() => setSubTab("users")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            subTab === "users"
              ? "border-amber-600 text-amber-700"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          User Management
        </button>
        <button
          onClick={() => setSubTab("personalisation")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
            subTab === "personalisation"
              ? "border-amber-600 text-amber-700"
              : "border-transparent text-stone-500 hover:text-stone-700"
          }`}
        >
          Personalisation
        </button>
      </div>

      {/* Personalisation sub-tab */}
      {subTab === "personalisation" && <PersonalisationTab />}

      {/* User Management sub-tab */}
      {subTab === "users" && (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">User Management</h2>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search users..."
            className="pl-9 pr-3 py-1.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-stone-400" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-500">
                  <th className="pb-2 font-medium">User</th>
                  <th className="pb-2 font-medium">Roles</th>
                  <th className="pb-2 font-medium">Organisation</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Free Sessions</th>
                  <th className="pb-2 font-medium">Subscription</th>
                  <th className="pb-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {users.map((u) => (
                  <tr
                    key={u.userId}
                    className="hover:bg-stone-50 cursor-pointer"
                    onClick={() => setSelectedUser(u)}
                  >
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        {u.userPhotoPath ? (
                          <img src={u.userPhotoPath} alt="" className="size-7 rounded-full object-cover" />
                        ) : (
                          <div className="size-7 rounded-full bg-amber-100 flex items-center justify-center text-xs font-medium text-amber-700">
                            {u.userName.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-stone-800">{u.userName}</p>
                            {u.emailVerifiedInd ? (
                              <span title="Email verified"><CheckCircle2 className="size-3.5 text-green-500" /></span>
                            ) : (
                              <span title="Email not verified"><XCircle className="size-3.5 text-red-400" /></span>
                            )}
                          </div>
                          <p className="text-xs text-stone-400">{u.userEmail}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span
                            key={r}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-stone-100 text-stone-600 cursor-pointer hover:bg-red-100 hover:text-red-600 transition-colors"
                            title={`Click to remove ${r}`}
                            onClick={() => handleRemoveRole(u.userId, r)}
                          >
                            {r}
                          </span>
                        ))}
                        <select
                          className="text-xs border border-stone-200 rounded px-1 py-0.5 text-stone-500"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) handleAssignRole(u.userId, parseInt(e.target.value));
                          }}
                        >
                          <option value="">+ Add</option>
                          {roles
                            .filter((r) => !u.roles.includes(r.roleName))
                            .map((r) => (
                              <option key={r.roleId} value={r.roleId}>
                                {r.roleName}
                              </option>
                            ))}
                        </select>
                      </div>
                    </td>
                    <td className="py-3 text-stone-600">{u.organisation ?? "—"}</td>
                    <td className="py-3">{statusBadge(u.userStatus)}</td>
                    <td className="py-3" onClick={(e) => e.stopPropagation()}>
                      {editingSessions === u.userId ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={sessionValue}
                            onChange={(e) => setSessionValue(parseInt(e.target.value) || 0)}
                            className="w-16 text-sm border border-stone-300 rounded px-1 py-0.5"
                          />
                          <button
                            onClick={() => handleSaveSessions(u.userId)}
                            className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingSessions(u.userId); setSessionValue(u.freeSessions); }}
                          className="text-stone-600 hover:text-amber-600 transition-colors"
                        >
                          {u.freeSessions}
                        </button>
                      )}
                    </td>
                    <td className="py-3 text-stone-600 text-xs">
                      {u.subscriptionTier} / {u.subscriptionStatus}
                    </td>
                    <td className="py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {u.userStatus === "active" && (
                          <button
                            onClick={() => handleAction(u.userId, "suspend")}
                            className="p-1 text-yellow-600 hover:bg-yellow-50 rounded transition-colors"
                            title="Suspend"
                          >
                            <UserX className="size-4" />
                          </button>
                        )}
                        {u.userStatus === "suspended" && (
                          <button
                            onClick={() => handleAction(u.userId, "reactivate")}
                            className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Reactivate"
                          >
                            <UserCheck className="size-4" />
                          </button>
                        )}
                        {u.userStatus !== "cancelled" && (
                          <button
                            onClick={() => handleAction(u.userId, "cancel")}
                            className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Cancel"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-stone-500">
              <span>
                {total} user{total !== 1 ? "s" : ""} total
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="p-1 disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span>
                  Page {page} of {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="p-1 disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* User detail slide-over */}
      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          availableRoles={roles}
          onClose={() => setSelectedUser(null)}
          onRefresh={() => {
            setSelectedUser(null);
            fetchUsers();
          }}
        />
      )}
    </div>
      )}
    </div>
  );
}
