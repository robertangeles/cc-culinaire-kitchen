import { XCircle } from "lucide-react";
import type { RoleOption } from "./userDetailTypes.js";

interface UserRolesSectionProps {
  userId: number;
  roles: string[];
  availableRoles: RoleOption[];
  onRefresh: () => void;
}

export function UserRolesSection({ userId, roles, availableRoles, onRefresh }: UserRolesSectionProps) {
  const unassignedRoles = availableRoles.filter((r) => !roles.includes(r.roleName));

  async function handleAssignRole(roleId: number) {
    await fetch(`/api/users/${userId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ roleId }),
    });
    onRefresh();
  }

  async function handleRemoveRole(roleName: string) {
    const r = availableRoles.find((role) => role.roleName === roleName);
    if (!r) return;
    await fetch(`/api/users/${userId}/roles/${r.roleId}`, {
      method: "DELETE",
      credentials: "include",
    });
    onRefresh();
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.length > 0 ? (
        roles.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-gold/10 text-gold border border-gold/20 cursor-pointer hover:bg-red-900/40 hover:text-red-400 hover:border-red-700/40 transition-colors"
            title={`Click to remove ${r}`}
            onClick={() => handleRemoveRole(r)}
          >
            {r}
            <XCircle className="size-3" />
          </span>
        ))
      ) : (
        <span className="text-sm text-dark-600 italic">No roles assigned</span>
      )}
      {unassignedRoles.length > 0 && (
        <select
          className="text-xs border border-dark-200 rounded px-1.5 py-0.5 text-dark-600"
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
  );
}
