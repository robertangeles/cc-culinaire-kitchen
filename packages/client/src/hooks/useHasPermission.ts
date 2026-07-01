/**
 * @module hooks/useHasPermission
 *
 * One shared client-side permission check, backed by the `permissions[]`
 * already carried on the authenticated user in AuthContext. Used by the
 * sidebar filter and the route-level permission guard so there is a single
 * source of truth. This is UX only — the server middleware is the real
 * security boundary.
 */

import { useAuth } from "../context/AuthContext.js";

export function useHasPermission() {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  // Administrators are superusers — implicit all-access (mirrors the server
  // requirePermission bypass) so new permissions never lock admins out.
  const isAdmin = user?.roles?.includes("Administrator") ?? false;

  /** True if the user is an Administrator or holds any of the given keys. */
  return function hasPermission(...keys: string[]): boolean {
    return isAdmin || keys.some((k) => permissions.includes(k));
  };
}
