/**
 * Which tabs a signed-in person sees. One entry per module: its route group under `app/(app)/`, its title, and
 * the permissions that open it (any one is enough, as in the web's `navConfig.ts`; none for a module the server opens to anyone
 * signed in). A new wave adds a folder
 * `app/(app)/(module)/` and one line here. Hiding a tab is never access control: the server checks every call.
 */

import type { AuthUser } from "../api/auth";
import type { TabIconName } from "../ui/TabIcon";

export interface ModuleTab {
  /** The route group folder, with its brackets. */
  route: string;
  title: string;
  icon: TabIconName;
  /** Left out when the server asks only for a signed-in person (no permission key on its routes). */
  anyPermission?: string[];
}

/** In the order a line cook reaches for them: prep all shift, waste and usage as they happen, counts at stock take, moves now and then, deliveries when they arrive; then Ask and Recipes, which everyone signed in gets. */
export const moduleTabs: ModuleTab[] = [
  // `prep:read` looks and ticks, `prep:manage` also makes the list: the server lets either tick, for anyone who works at the location (any role can be given them).
  { route: "(prep)", title: "Prep", icon: "prep", anyPermission: ["prep:read", "prep:manage"] },
  // `waste:log` is the key to log, edit and delete your own entries (reports and the team view are `waste:read`, not on the phone yet).
  { route: "(waste)", title: "Waste", icon: "waste", anyPermission: ["waste:log"] },
  // The server gates the consumption log and stock movements with `inventory:count` (the web's "Internal Usage" and "Move Between Areas").
  { route: "(usage)", title: "Usage", icon: "usage", anyPermission: ["inventory:count"] },
  { route: "(count)", title: "Count", icon: "count", anyPermission: ["inventory:count"] },
  { route: "(moves)", title: "Move", icon: "move", anyPermission: ["inventory:count"] },
  { route: "(receive)", title: "Receive", icon: "receive", anyPermission: ["purchasing:receive"] },
  // Chat, saved conversations and recipes check only that someone is signed in (`authenticate`/`authenticateOrGuest`, no permission key).
  { route: "(chat)", title: "Ask", icon: "chat" },
  { route: "(recipes)", title: "Recipes", icon: "recipes" },
];

/** Administrators hold every permission implicitly, as on the web and the server. */
export function hasAnyPermission(user: AuthUser, keys: string[]): boolean {
  return user.roles.includes("Administrator") || keys.some((k) => user.permissions.includes(k));
}

export const canOpen = (user: AuthUser, tab: ModuleTab) => !tab.anyPermission || hasAnyPermission(user, tab.anyPermission);

/** Everyone also gets the Account tab (sign out, location). */
export const visibleTabs = (user: AuthUser) => moduleTabs.filter((t) => canOpen(user, t));

/** The most buttons the tab bar holds: more than five do not fit a phone's width with labels a cook can read. */
export const MAX_TABS = 5;

/**
 * What goes on the tab bar and what goes under More. Up to five buttons: the person's modules, then Account. When that is more than five,
 * the first four modules stay on the bar and the fifth button is More, which lists the rest and Account.
 */
export function tabBar(user: AuthUser): { bar: ModuleTab[]; more: ModuleTab[] } {
  const tabs = visibleTabs(user);
  if (tabs.length + 1 <= MAX_TABS) return { bar: tabs, more: [] };
  return { bar: tabs.slice(0, MAX_TABS - 1), more: tabs.slice(MAX_TABS - 1) };
}

/**
 * What VoiceOver reads for each button on the bar, by title: its place among the buttons that show. The library counts every route in the
 * navigator, the ones under More too, so an Administrator's More would be read as "10 of 10".
 */
export function tabLabels(user: AuthUser): Record<string, string> {
  const { bar, more } = tabBar(user);
  const titles = [...bar.map((t) => t.title), more.length > 0 ? "More" : "Account"];
  return Object.fromEntries(titles.map((title, i) => [title, `${title}, tab, ${i + 1} of ${titles.length}`]));
}
