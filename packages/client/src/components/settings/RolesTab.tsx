/**
 * @module components/settings/RolesTab
 *
 * Admin role management: create, edit, delete roles
 * and assign permissions via checkboxes.
 */

import { useState, useEffect, useCallback, type FormEvent } from "react";
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  X,
  Check,
  AlertCircle,
} from "lucide-react";

interface Permission {
  permissionId: number;
  permissionKey: string;
  permissionDescription: string | null;
}

interface Role {
  roleId: number;
  roleName: string;
  roleDescription: string | null;
  permissions: { permissionId: number; permissionKey: string }[];
}

export function RolesTab() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // New role form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit role
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        fetch("/api/roles", { credentials: "include" }),
        fetch("/api/permissions", { credentials: "include" }),
      ]);
      if (rolesRes.ok) {
        const data = await rolesRes.json();
        setRoles(data.roles);
      }
      if (permsRes.ok) {
        const data = await permsRes.json();
        setPermissions(data.permissions);
      }
    } catch {
      setError("Failed to load roles.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roleName: newName, roleDescription: newDesc || undefined }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to create role");
      }
      setNewName("");
      setNewDesc("");
      setShowCreate(false);
      fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(roleId: number) {
    await fetch(`/api/roles/${roleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ roleName: editName, roleDescription: editDesc || undefined }),
    });
    setEditingId(null);
    fetchData();
  }

  async function handleDelete(roleId: number) {
    await fetch(`/api/roles/${roleId}`, {
      method: "DELETE",
      credentials: "include",
    });
    fetchData();
  }

  async function handleTogglePermission(roleId: number, permissionId: number, currentPerms: number[]) {
    const newPerms = currentPerms.includes(permissionId)
      ? currentPerms.filter((id) => id !== permissionId)
      : [...currentPerms, permissionId];

    await fetch(`/api/roles/${roleId}/permissions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ permissionIds: newPerms }),
    });
    fetchData();
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-stone-400" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-stone-800">Roles & Permissions</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
        >
          <Plus className="size-4" />
          New Role
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="size-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-stone-50 rounded-xl p-4 space-y-3 border border-stone-200">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Role Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Description</label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              {creating && <Loader2 className="size-4 animate-spin inline mr-1" />}
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-sm text-stone-600 hover:text-stone-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {roles.map((r) => {
          const permIds = r.permissions.map((p) => p.permissionId);
          const isEditing = editingId === r.roleId;

          return (
            <div key={r.roleId} className="bg-white rounded-xl border border-stone-200 p-4">
              <div className="flex items-start justify-between mb-3">
                {isEditing ? (
                  <div className="flex-1 space-y-2 mr-4">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description"
                      className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                ) : (
                  <div>
                    <h3 className="font-semibold text-stone-800">{r.roleName}</h3>
                    {r.roleDescription && (
                      <p className="text-sm text-stone-500">{r.roleDescription}</p>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => handleSaveEdit(r.roleId)}
                        className="p-1 text-green-600 hover:bg-green-50 rounded"
                      >
                        <Check className="size-4" />
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="p-1 text-stone-400 hover:bg-stone-100 rounded"
                      >
                        <X className="size-4" />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => { setEditingId(r.roleId); setEditName(r.roleName); setEditDesc(r.roleDescription ?? ""); }}
                        className="p-1 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(r.roleId)}
                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {permissions.map((p) => (
                  <label
                    key={p.permissionId}
                    title={p.permissionKey}
                    className="flex items-start gap-2 text-sm text-stone-600 cursor-pointer hover:text-stone-800 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={permIds.includes(p.permissionId)}
                      onChange={() => handleTogglePermission(r.roleId, p.permissionId, permIds)}
                      className="mt-0.5 rounded border-stone-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>
                      <span className="block font-medium text-stone-700">{p.permissionDescription ?? p.permissionKey}</span>
                      <span className="block text-xs text-stone-400">{p.permissionKey}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
