import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import inventoryRouter from "./inventory.js";

/**
 * Permission-boundary tests for the storage-area + stock-movement routes.
 *
 * Hiding a nav item is never access control — the server route is the security
 * boundary. These tests assert the ACTUAL middleware wired onto each route (not
 * `requirePermission` in isolation), so a refactor that drops or downgrades a
 * gate fails here rather than in production.
 *
 * Hermetic: the permission gate never touches the DB or the controllers, so
 * this runs in the main CI job. The real-DB behaviour lives in
 * storageAreas.integration.test.ts.
 *
 * The keys are deliberately the three that already exist — no new permission
 * key means no seed change and no prod backfill. Areas are catalog admin
 * (inventory:manage to edit, inventory:count to read); recording a physical
 * move is a counting-staff action (inventory:count), matching
 * POST /consumption-logs.
 */

type Handler = (req: Request, res: Response, next: () => void) => void;

/** The middleware stack Express actually wired for `method path`. */
function layerFor(method: string, path: string): Handler[] {
  const layer = (inventoryRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method.toLowerCase()],
  );
  if (!layer) throw new Error(`no route wired for ${method} ${path}`);
  return layer.route.stack.map((s: any) => s.handle);
}

/**
 * Drive every middleware on the route with this user and report what happened.
 * Controllers sit last in the stack and would hit the DB, so we stop as soon as
 * a gate responds; reaching the controller means every gate passed.
 */
function runGates(handlers: Handler[], user: unknown): { status: number | null } {
  const req = { user, params: {}, query: {}, body: {} } as unknown as Request;
  let status: number | null = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;

  // Walk gates only — never invoke the final handler (the controller).
  for (const handler of handlers.slice(0, -1)) {
    let advanced = false;
    handler(req, res, () => {
      advanced = true;
    });
    if (!advanced) return { status };
  }
  return { status };
}

const ROUTES: Array<{ method: string; path: string; permission: string }> = [
  { method: "GET", path: "/locations/:locId/storage-areas", permission: "inventory:count" },
  { method: "POST", path: "/locations/:locId/storage-areas", permission: "inventory:manage" },
  { method: "GET", path: "/locations/:locId/storage-areas/assignments", permission: "inventory:count" },
  { method: "PATCH", path: "/storage-areas/:areaId", permission: "inventory:manage" },
  { method: "DELETE", path: "/storage-areas/:areaId", permission: "inventory:manage" },
  { method: "GET", path: "/storage-areas/:areaId/items", permission: "inventory:count" },
  { method: "PUT", path: "/storage-areas/:areaId/items", permission: "inventory:manage" },
  { method: "POST", path: "/locations/:locId/stock-movements", permission: "inventory:count" },
  { method: "GET", path: "/locations/:locId/stock-movements", permission: "inventory:count" },
];

const ALL_KEYS = ["inventory:count", "inventory:manage", "inventory:hq"];

describe("storage-area + stock-movement routes — permission boundary", () => {
  it("every route is wired (a typo in the path would silently 404 in prod)", () => {
    for (const r of ROUTES) {
      expect(() => layerFor(r.method, r.path), `${r.method} ${r.path}`).not.toThrow();
    }
  });

  it.each(ROUTES)("$method $path → 401 without a token", ({ method, path }) => {
    const { status } = runGates(layerFor(method, path), undefined);
    expect(status).toBe(401);
  });

  it.each(ROUTES)("$method $path → 403 with no permissions", ({ method, path }) => {
    const { status } = runGates(layerFor(method, path), { sub: 1, roles: ["Subscriber"], permissions: [] });
    expect(status).toBe(403);
  });

  it.each(ROUTES)("$method $path → passes with $permission", ({ method, path, permission }) => {
    const { status } = runGates(layerFor(method, path), {
      sub: 1,
      roles: ["Subscriber"],
      permissions: [permission],
    });
    expect(status).toBeNull();
  });

  it.each(ROUTES)("$method $path → Administrator bypasses the gate", ({ method, path }) => {
    const { status } = runGates(layerFor(method, path), {
      sub: 1,
      roles: ["Administrator"],
      permissions: [],
    });
    expect(status).toBeNull();
  });

  it.each(ROUTES.filter((r) => r.permission === "inventory:manage"))(
    "$method $path → 403 for a counter (inventory:count is NOT enough to edit areas)",
    ({ method, path }) => {
      const { status } = runGates(layerFor(method, path), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["inventory:count"],
      });
      expect(status).toBe(403);
    },
  );

  it("introduces no new permission key — no seed change, no prod backfill", () => {
    for (const r of ROUTES) {
      expect(ALL_KEYS, `${r.method} ${r.path} uses an unknown key`).toContain(r.permission);
    }
  });
});
