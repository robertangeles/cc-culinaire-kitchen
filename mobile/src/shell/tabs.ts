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
  /** A build-time switch: the module is in no tab list, bar or More unless this says so. */
  buildFlag?: () => boolean;
  /** Never a button of its own: always listed under More, so the bar stays as it is (owner). */
  underMore?: true;
}

// Metro inlines `process.env.EXPO_PUBLIC_*` only when written out by name.
const benchBuild = () => process.env.EXPO_PUBLIC_BENCH === "on";

/** In the order a line cook reaches for them: prep all shift, waste and usage as they happen, counts at stock take, moves now and then, deliveries when they arrive, orders for those who raise or approve them; then Ask and Recipes, which everyone signed in gets. */
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
  // The web's Purchasing page opens on any purchasing key; `purchasing:receive` alone is left to Receive, the only orders the server lists for it.
  { route: "(orders)", title: "Orders", icon: "orders", anyPermission: ["purchasing:draft", "purchasing:submit", "purchasing:approve", "purchasing:credit"] },
  // Chat, saved conversations and recipes check only that someone is signed in (`authenticate`/`authenticateOrGuest`, no permission key).
  { route: "(chat)", title: "Ask", icon: "chat" },
  { route: "(recipes)", title: "Recipes", icon: "recipes" },
  // Everyone's notifications (the web bell's routes ask only for a sign-in), with the unread count on its button or on More.
  { route: "(inbox)", title: "Inbox", icon: "inbox" },
  // Listing and receiving transfers is `inventory:count` on the server; making, sending and cancelling one is `inventory:manage` (the screens offer those only to holders).
  { route: "(transfers)", title: "Transfers", icon: "transfer", anyPermission: ["inventory:count"] },
  // The dashboard, the location's items and catalogue requests are `inventory:count`; stock value and quantities also need `inventory:cost`.
  { route: "(stock)", title: "Stock", icon: "stock", anyPermission: ["inventory:count"] },
  // Reading the menu and recording a sale are `menu:read` on the server; changing it is `menu:manage`, and costs show only with `inventory:cost`.
  { route: "(menu)", title: "Menu", icon: "menu", anyPermission: ["menu:read"] },
  // What CulinAIre remembers for this person; removing a memory is `brain:manage` on the server.
  { route: "(brain)", title: "Brain", icon: "brain", anyPermission: ["brain:read"] },
  // Team chat: the server asks only for a sign-in and checks each room (a kitchen's members, a thread's two people). Only in a build made with EXPO_PUBLIC_BENCH=on: a store build waits for the owner's decision (App Store 1.2, mobile/README.md).
  { route: "(bench)", title: "Bench", icon: "bench", buildFlag: benchBuild },
  // The staff side of the web's Roster page and of Profile > My Documents: the person's own shifts and their own documents.
  { route: "(roster)", title: "Roster", icon: "roster", anyPermission: ["roster:read-own"], underMore: true },
  { route: "(documents)", title: "Documents", icon: "documents", anyPermission: ["compliance:read-own"], underMore: true },
];

/** Administrators hold every permission implicitly, as on the web and the server. */
export function hasAnyPermission(user: AuthUser, keys: string[]): boolean {
  return user.roles.includes("Administrator") || keys.some((k) => user.permissions.includes(k));
}

export const canOpen = (user: AuthUser, tab: ModuleTab) => (!tab.buildFlag || tab.buildFlag()) && (!tab.anyPermission || hasAnyPermission(user, tab.anyPermission));

/** Everyone also gets the Account tab (sign out, location). */
export const visibleTabs = (user: AuthUser) => moduleTabs.filter((t) => canOpen(user, t));

/** The most buttons the tab bar holds: more than five do not fit a phone's width with labels a cook can read. */
export const MAX_TABS = 5;

/**
 * What goes on the tab bar and what goes under More. Up to five buttons: the person's modules, then Account. When that is more than five,
 * the first four modules stay on the bar and the fifth button is More, which lists the rest and Account. A module marked `underMore` is
 * only ever listed there, so a person who has one gets More as their last button instead of Account.
 */
export function tabBar(user: AuthUser): { bar: ModuleTab[]; more: ModuleTab[] } {
  const tabs = visibleTabs(user);
  const buttons = tabs.filter((t) => !t.underMore);
  const bar = buttons.length + 1 <= MAX_TABS ? buttons : buttons.slice(0, MAX_TABS - 1);
  return { bar, more: tabs.filter((t) => !bar.includes(t)) };
}

/**
 * Where the signed-in app opens: the first button on the person's bar, the module they reach for most (Prep for a cook who preps, Waste for one
 * who only logs waste, Ask for someone with no module). Group-qualified, because every module's list is `index` and a bare "/" would open
 * whichever route group sorts first (Ask).
 */
export const homeHref = (user: AuthUser) => `/${tabBar(user).bar[0].route}`;

/**
 * What VoiceOver reads for each button on the bar, by title: its place among the buttons that show. The library counts every route in the
 * navigator, the ones under More too, so an Administrator's More would be read as "10 of 10".
 */
export function tabLabels(user: AuthUser): Record<string, string> {
  const { bar, more } = tabBar(user);
  const titles = [...bar.map((t) => t.title), more.length > 0 ? "More" : "Account"];
  return Object.fromEntries(titles.map((title, i) => [title, `${title}, tab, ${i + 1} of ${titles.length}`]));
}
