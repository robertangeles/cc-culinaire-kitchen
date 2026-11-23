import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { menuIntelligenceRouter } from "./menuIntelligence.js";

/**
 * Wave 7 split: menu:read reads the menu and records a sale; menu:manage edits it (items, recipe lines, category
 * targets, recalculation, legacy CSV overwrite), voids a sale and runs the paid model call. Walks the real router,
 * so a route that loses its gate fails here.
 */

type Handler = (req: Request, res: Response, next: () => void) => void;

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
    // `authenticate` needs a token and a database, multer needs a multipart body, and the location guard is a param handler; the permission gates are what is under test.
    if (g.name === "authenticate" || g.name === "multerMiddleware") continue;
    let passed = false;
    g(req, res, () => {
      passed = true;
    });
    if (!passed) return false;
  }
  return true;
}

const readRoutes: Array<[string, string]> = [
  ["get", "/items"],
  ["get", "/items/:id/ingredients"],
  ["get", "/items/:id/pandl-cost"],
  ["get", "/analysis"],
  ["get", "/categories"],
  ["get", "/waste-impact"],
  ["get", "/yield-variance"],
  ["get", "/items/:id/yield-variance"],
  // Builds a text prompt for Recipe Lab; it calls no model.
  ["post", "/items/:id/generate-replacement"],
  // Selling is not editing the menu: any member who may sell can sell any item.
  ["post", "/items/:id/sales"],
  ["get", "/locations/:locId/sales"],
  ["get", "/consumables"],
  ["post", "/consumables/:ingredientId/sales"],
  ["post", "/sales/import/preview"],
  ["post", "/sales/import/commit"],
];

const manageRoutes: Array<[string, string]> = [
  ["post", "/items"],
  ["patch", "/items/:id"],
  ["delete", "/items/:id"],
  ["post", "/items/:id/ingredients"],
  ["delete", "/items/:id/ingredients/:ingredientId"],
  ["post", "/items/:id/ingredients/:ingredientId/refresh-cost"],
  ["post", "/analysis/recalculate"],
  ["put", "/categories/:name"],
  ["post", "/import-sales"],
  // The paid model call.
  ["get", "/items/:id/recommendations"],
  ["post", "/sales/:saleId/void"],
];

describe("menu routes", () => {
  it.each(readRoutes)("%s %s is open to menu:read alone", (method, path) => {
    const gates = gatesFor(menuIntelligenceRouter, method, path);
    expect(allows(gates, { permissions: ["menu:read"] })).toBe(true);
    expect(allows(gates, { permissions: ["menu:read", "menu:manage"] })).toBe(true);
  });

  it.each(manageRoutes)("%s %s needs menu:manage on top of menu:read", (method, path) => {
    const gates = gatesFor(menuIntelligenceRouter, method, path);
    expect(allows(gates, { permissions: ["menu:read"] })).toBe(false);
    expect(allows(gates, { permissions: ["menu:read", "menu:manage"] })).toBe(true);
  });

  it.each([...readRoutes, ...manageRoutes])("%s %s is closed to menu:manage alone, to others and to an anonymous request, and open to Administrator", (method, path) => {
    const gates = gatesFor(menuIntelligenceRouter, method, path);
    expect(allows(gates, { permissions: ["menu:manage"] })).toBe(false);
    expect(allows(gates, { permissions: ["waste:read", "sales:record"] })).toBe(false);
    expect(allows(gates, undefined)).toBe(false);
    expect(allows(gates, { permissions: [], roles: ["Administrator"] })).toBe(true);
  });

  it("every route in the router is in one of the two tables, so a new route cannot skip the choice", () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const routes = (menuIntelligenceRouter as unknown as { stack: Layer[] }).stack.flatMap((l) =>
      l.route ? Object.keys(l.route.methods).map((m) => `${m} ${l.route!.path}`) : [],
    );
    const listed = new Set([...readRoutes, ...manageRoutes].map(([m, p]) => `${m} ${p}`));
    expect(routes.filter((r) => !listed.has(r))).toEqual([]);
    expect(routes.length).toBe(listed.size);
  });
});
