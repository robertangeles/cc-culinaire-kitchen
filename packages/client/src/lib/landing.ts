/**
 * @module lib/landing
 *
 * Computes where a user should land after login, so each role arrives on a
 * screen that feels made for them: an owner/admin on Menu & Costing, everyone
 * else on chat. Always falls back to /chat/new — every seeded role holds
 * `chat:access`, so the fallback can never bounce a user into a 403.
 */

import type { AuthUser } from "../context/AuthContext.js";

/**
 * Route a freshly-logged-in user to a sensible home. Permission-driven, NOT
 * role-name driven: anyone who can see Menu & Costing (owners, GMs, custom
 * management roles — not just the literal "Administrator" role) starts there;
 * everyone else on chat. The server OAuth callback mirrors this same rule
 * (authController handleGoogleCallback) so both auth paths land consistently.
 */
export function computeLandingRoute(user: AuthUser | null | undefined): string {
  const CHAT = "/chat/new";
  if (!user) return CHAT;

  // Menu & Costing is the "run the numbers" home. LocationGate handles the
  // "no location yet" case gracefully, so this can't dead-end. Administrators
  // are superusers (implicit menu:read), so they land here too.
  const isAdmin = user.roles?.includes("Administrator");
  if (isAdmin || user.permissions?.includes("menu:read")) return "/menu-intelligence";

  return CHAT;
}
