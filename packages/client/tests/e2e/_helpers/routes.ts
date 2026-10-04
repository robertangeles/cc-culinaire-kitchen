/**
 * Every client page route in App.tsx, classed by who may see it. One table
 * drives the authenticated smoke spec and the logged-out boundary spec.
 * Parameterised paths use fixed values (a nonexistent id, the `terms` slug).
 * `/*` and `*` are wrappers, not pages, and are not listed.
 */
export type RouteKind = "gated" | "guest-open" | "public";

export const ROUTES: ReadonlyArray<{ path: string; kind: RouteKind }> = [
  { path: "/settings", kind: "gated" },
  { path: "/profile", kind: "gated" },
  { path: "/organisation", kind: "gated" },
  { path: "/my-shelf", kind: "gated" },
  { path: "/your-brain", kind: "gated" },
  { path: "/menu-intelligence", kind: "gated" },
  { path: "/waste-intelligence", kind: "gated" },
  { path: "/roster", kind: "gated" },
  { path: "/kitchen-copilot", kind: "gated" },
  { path: "/inventory", kind: "gated" },
  { path: "/purchasing", kind: "gated" },
  { path: "/chat/new", kind: "guest-open" },
  { path: "/chat/00000000-0000-0000-0000-000000000000", kind: "guest-open" },
  { path: "/recipes", kind: "guest-open" },
  { path: "/patisserie", kind: "guest-open" },
  { path: "/spirits", kind: "guest-open" },
  { path: "/bench", kind: "guest-open" },
  { path: "/kitchen-shelf", kind: "guest-open" },
  { path: "/kitchen-shelf/00000000-0000-0000-0000-000000000000", kind: "guest-open" },
  { path: "/", kind: "public" },
  { path: "/login", kind: "public" },
  { path: "/register", kind: "public" },
  { path: "/verify-email", kind: "public" },
  { path: "/forgot-password", kind: "public" },
  { path: "/reset-password", kind: "public" },
  { path: "/terms", kind: "public" },
  { path: "/privacy", kind: "public" },
  { path: "/delete-account", kind: "public" },
  { path: "/pages/terms", kind: "public" },
];
