/**
 * @module components/layout/navConfig
 *
 * Data-driven definition of the primary sidebar navigation. The sidebar
 * renders from this config so that what each user sees is derived from their
 * permissions — a line cook sees the line tools, an owner sees menu/orders/
 * money. This is UX only; the security boundary is server-side middleware.
 *
 * Labels are kitchen-native on purpose (Ask Antoine, Food Laboratory, Prep, …).
 * Changing a `label` here is a display-only change — never change `to` (route
 * paths) here, and never rename a route's `guideKey`.
 */

import {
  MessageSquare,
  UtensilsCrossed,
  Croissant,
  GlassWater,
  BookMarked,
  Brain,
  Package,
  ShoppingCart,
  BarChart3,
  ClipboardList,
  Leaf,
  LayoutGrid,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";

/** How an item/section is gated for the current user. */
export type NavGate =
  | "guest-ok" // visible to everyone, including guest sessions
  | "auth" // visible to authenticated (non-guest) users
  | { anyPermission: string[] }; // visible if the user holds any listed permission

/** The auth/permission facts the filter needs about the current viewer. */
export interface NavContext {
  isAuthenticated: boolean;
  isGuest: boolean;
  permissions: string[];
  /** Role names — used for the Administrator superuser bypass. */
  roles: string[];
}

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  to: string;
  gate: NavGate;
}

export interface NavSection {
  id: string;
  /** Group header. `null` for the top, ungrouped items (e.g. Ask Antoine). */
  label: string | null;
  items: NavItem[];
}

/**
 * The full navigation. Order is intentional: the front door (Ask Antoine)
 * first, then R&D (Food Laboratory), then daily ops (Run the Kitchen), then
 * Community.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: "top",
    label: null,
    items: [
      { id: "chat", label: "Ask Antoine", icon: MessageSquare, to: "/chat/new", gate: "guest-ok" },
      {
        id: "your-brain",
        label: "Your Brain",
        icon: Brain,
        to: "/your-brain",
        gate: { anyPermission: ["brain:read"] },
      },
    ],
  },
  {
    id: "test-kitchen",
    label: "Food Laboratory",
    items: [
      { id: "recipe-lab", label: "Recipe Lab", icon: UtensilsCrossed, to: "/recipes", gate: "guest-ok" },
      { id: "pastry-lab", label: "Pastry Lab", icon: Croissant, to: "/patisserie", gate: "guest-ok" },
      { id: "cocktail-lab", label: "Cocktail Lab", icon: GlassWater, to: "/spirits", gate: "guest-ok" },
    ],
  },
  {
    id: "run-the-kitchen",
    label: "Run the Kitchen",
    items: [
      { id: "my-recipe-book", label: "My Recipe Book", icon: BookMarked, to: "/my-shelf", gate: "auth" },
      {
        id: "stock-room",
        label: "Stock Room",
        icon: Package,
        to: "/inventory",
        gate: { anyPermission: ["inventory:count", "inventory:manage", "inventory:transfer", "inventory:hq"] },
      },
      {
        id: "ordering",
        label: "Ordering",
        icon: ShoppingCart,
        to: "/purchasing",
        gate: { anyPermission: ["purchasing:draft", "purchasing:submit", "purchasing:approve", "purchasing:receive", "purchasing:credit"] },
      },
      {
        id: "menu-costing",
        label: "Menu & Costing",
        icon: BarChart3,
        to: "/menu-intelligence",
        gate: { anyPermission: ["menu:read"] },
      },
      {
        id: "prep",
        label: "Prep",
        icon: ClipboardList,
        to: "/kitchen-copilot",
        gate: { anyPermission: ["prep:manage"] },
      },
      {
        id: "waste",
        label: "Waste",
        icon: Leaf,
        to: "/waste-intelligence",
        gate: { anyPermission: ["waste:read"] },
      },
    ],
  },
  {
    id: "community",
    label: "Community",
    items: [
      { id: "community-recipes", label: "Community Recipes", icon: LayoutGrid, to: "/kitchen-shelf", gate: "guest-ok" },
      { id: "the-bench", label: "The Bench", icon: MessagesSquare, to: "/bench", gate: "guest-ok" },
    ],
  },
];

/** True if a single item is visible to the given viewer. */
export function isItemVisible(gate: NavGate, ctx: NavContext): boolean {
  if (gate === "guest-ok") return true;
  if (gate === "auth") return ctx.isAuthenticated;
  // Permission gate — requires a real (non-guest) authenticated user holding
  // at least one of the listed permissions. Default permissions to [] so a
  // user object mid-refresh (or an older /me payload) never throws here.
  if (!ctx.isAuthenticated) return false;
  // Administrators are superusers — implicit all-access (mirrors the server
  // requirePermission bypass) so new permissions never hide modules from admins.
  if (ctx.roles?.includes("Administrator")) return true;
  const permissions = ctx.permissions ?? [];
  return gate.anyPermission.some((p) => permissions.includes(p));
}

/**
 * Filter the nav for the current viewer: drop items they can't see, then drop
 * any section left with zero visible items (no orphan headers).
 */
export function filterNav(sections: NavSection[], ctx: NavContext): NavSection[] {
  const permissions = ctx.permissions ?? [];
  const safeCtx: NavContext = { ...ctx, permissions };
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => isItemVisible(item.gate, safeCtx)),
    }))
    .filter((section) => section.items.length > 0);
}
