import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { wasteRouter } from "./waste.js";
import { prepRouter } from "./prep.js";
import inventoryRouter from "./inventory.js";

/**
 * Wave 2 permission splits, per route. waste:read (reports, team view, AI reuse) is not waste:log (log,
 * edit, delete your own entries); prep:manage (create, generate, end) is not prep:read (read, tick).
 * Walks the real router, so a route that loses its gate fails here.
 */

type Handler = (req: Request, res: Response, next: () => void) => void;

/** The gates in front of a route: the router-level `use` layers that precede it, then the route's own middleware (all but the handler). */
function gatesFor(router: unknown, method: string, path: string): Handler[] {
  const stack = (router as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Handler }> }; handle: Handler }> }).stack;
  const gates: Handler[] = [];
  for (const layer of stack) {
    if (!layer.route) {
      gates.push(layer.handle);
      continue;
    }
    if (layer.route.path === path && layer.route.methods[method]) {
      const own = layer.route.stack.map((s) => s.handle);
      return [...gates, ...own.slice(0, -1)];
    }
  }
  throw new Error(`no ${method} ${path}`);
}

/** Runs the gates in order the way Express would; true when the request got past all of them. */
function allows(gates: Handler[], user: { permissions: string[]; roles?: string[] } | undefined): boolean {
  const req = { user: user ? { sub: 1, roles: user.roles ?? [], permissions: user.permissions } : undefined } as unknown as Request;
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() } as unknown as Response;
  for (const g of gates) {
    // `authenticate` needs a token and a database; the permission gates are what is under test.
    if (g.name === "authenticate") continue;
    let passed = false;
    g(req, res, () => {
      passed = true;
    });
    if (!passed) return false;
  }
  return true;
}

const waste: Array<[string, string, string[]]> = [
  ["post", "/", ["waste:log"]],
  ["patch", "/:id", ["waste:log"]],
  ["delete", "/:id", ["waste:log"]],
  ["get", "/summary", ["waste:read"]],
  ["post", "/reuse", ["waste:read"]],
  ["get", "/", ["waste:read", "waste:log"]],
  ["get", "/suggestions", ["waste:read", "waste:log"]],
  // The phone's ingredient picker for a cook who may log waste but not count stock; inventory:count holders may read the same list.
  ["get", "/ingredients", ["waste:log"]],
];

const prep: Array<[string, string, string[]]> = [
  ["post", "/sessions", ["prep:manage"]],
  ["post", "/sessions/:id/selections", ["prep:manage"]],
  ["post", "/sessions/:id/generate", ["prep:manage"]],
  ["patch", "/sessions/:id/end", ["prep:manage"]],
  ["patch", "/tasks/:id", ["prep:read", "prep:manage"]],
  ["get", "/sessions/today", ["prep:read", "prep:manage"]],
  ["get", "/sessions/:id", ["prep:read", "prep:manage"]],
  ["get", "/history", ["prep:read", "prep:manage"]],
  ["get", "/menu", ["prep:read", "prep:manage"]],
];

describe.each([
  ["waste", wasteRouter, waste, ["waste:read", "waste:log"]],
  ["prep", prepRouter, prep, ["prep:read", "prep:manage"]],
] as const)("%s routes", (_name, router, table, keys) => {
  it.each(table)("%s %s accepts exactly %j", (method, path, accepted) => {
    const gates = gatesFor(router, method, path);
    for (const key of keys) {
      expect(allows(gates, { permissions: [key] }), `${key} on ${method} ${path}`).toBe(accepted.includes(key));
    }
    expect(allows(gates, { permissions: ["chat:access"] })).toBe(false);
    expect(allows(gates, undefined)).toBe(false);
    expect(allows(gates, { permissions: [], roles: ["Administrator"] })).toBe(true);
  });
});

describe("GET /waste/org-context (the team/personal toggle for waste and prep)", () => {
  const gates = gatesFor(wasteRouter, "get", "/org-context");

  it.each(["waste:read", "waste:log", "prep:read", "prep:manage"])("is open to a holder of %s", (key) => {
    expect(allows(gates, { permissions: [key] })).toBe(true);
  });

  it("still refuses a signed-in user with no waste or prep access, and an anonymous request", () => {
    expect(allows(gates, { permissions: ["chat:access"] })).toBe(false);
    expect(allows(gates, undefined)).toBe(false);
  });
});

describe("GET /waste/ingredients (the picker list for a cook who logs waste but cannot count stock)", () => {
  const gates = gatesFor(wasteRouter, "get", "/ingredients");

  it("is open to a holder of inventory:count too, who may already read the full list", () => {
    expect(allows(gates, { permissions: ["inventory:count"] })).toBe(true);
  });

  it("is closed to waste:read alone (reports are not logging) and to inventory:manage alone", () => {
    expect(allows(gates, { permissions: ["waste:read"] })).toBe(false);
    expect(allows(gates, { permissions: ["inventory:manage"] })).toBe(false);
  });
});

describe("a user holding only waste:log on the inventory routes", () => {
  type Layer = { route?: { path: string; methods: Record<string, boolean> } };
  const routes = (inventoryRouter as unknown as { stack: Layer[] }).stack.flatMap((l) =>
    l.route ? Object.keys(l.route.methods).map((m) => [m, l.route!.path] as const) : [],
  );

  it("reaches no inventory route but the signed-in user's own notifications, so the new list is the only door to ingredients", () => {
    expect(routes.length).toBeGreaterThan(50);
    const open = routes.filter(([method, path]) => allows(gatesFor(inventoryRouter, method, path), { permissions: ["waste:log"] }));
    expect(open.every(([, path]) => path.startsWith("/notifications"))).toBe(true);
  });
});
