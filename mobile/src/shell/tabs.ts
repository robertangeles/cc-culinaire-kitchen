/**
 * Which tabs a signed-in person sees. One entry per module: its route group under `app/(app)/`, its title, and
 * the permissions that open it (any one is enough, as in the web's `navConfig.ts`). A new wave adds a folder
 * `app/(app)/(module)/` and one line here. Hiding a tab is never access control: the server checks every call.
 */

import type { AuthUser } from "../api/auth";
import type { TabIconName } from "../ui/TabIcon";

export interface ModuleTab {
  /** The route group folder, with its brackets. */
  route: string;
  title: string;
  icon: TabIconName;
  anyPermission: string[];
}

export const moduleTabs: ModuleTab[] = [
  { route: "(count)", title: "Count", icon: "count", anyPermission: ["inventory:count"] },
  // `waste:log` is the key to log, edit and delete your own entries (reports and the team view are `waste:read`, not on the phone yet).
  { route: "(waste)", title: "Waste", icon: "waste", anyPermission: ["waste:log"] },
  // `prep:read` looks and ticks, `prep:manage` also makes the list: the server lets either tick, for anyone who works at the location (any role can be given them).
  { route: "(prep)", title: "Prep", icon: "prep", anyPermission: ["prep:read", "prep:manage"] },
  // The server gates the consumption log and stock movements with `inventory:count` (the web's "Internal Usage" and "Move Between Areas").
  { route: "(usage)", title: "Usage", icon: "usage", anyPermission: ["inventory:count"] },
  { route: "(moves)", title: "Move", icon: "move", anyPermission: ["inventory:count"] },
];

/** Administrators hold every permission implicitly, as on the web and the server. */
export function hasAnyPermission(user: AuthUser, keys: string[]): boolean {
  return user.roles.includes("Administrator") || keys.some((k) => user.permissions.includes(k));
}

export const canOpen = (user: AuthUser, tab: ModuleTab) => hasAnyPermission(user, tab.anyPermission);

/** Everyone also gets the Account tab (sign out, location), so a person with no module still has somewhere to go. */
export const visibleTabs = (user: AuthUser) => moduleTabs.filter((t) => canOpen(user, t));
