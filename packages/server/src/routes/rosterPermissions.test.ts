import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import rosterRouter from "./roster.js";

/**
 * Permission-boundary tests for Roster Core routes.
 *
 * Hiding a nav item is never access control — the server route is the security
 * boundary. These tests assert the ACTUAL middleware wired onto each route (not
 * `requirePermission` in isolation), so a refactor that drops or downgrades a
 * gate fails here rather than in production. Copied structurally from
 * compliancePermissions.test.ts.
 *
 * Hermetic: the permission gate never touches the DB or the controllers, so
 * this runs in the main CI job.
 */

type Handler = (req: Request, res: Response, next: () => void) => void;

function layerFor(method: string, path: string): Handler[] {
  const layer = (rosterRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method.toLowerCase()],
  );
  if (!layer) throw new Error(`no route wired for ${method} ${path}`);
  return layer.route.stack.map((s: any) => s.handle);
}

function runGates(handlers: Handler[], user: unknown): { status: number | null } {
  const req = { user, params: {}, query: {}, body: {}, headers: {} } as unknown as Request;
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
  { method: "GET", path: "/roles", permission: "roster:read-all" },
  { method: "POST", path: "/roles", permission: "roster:manage" },
  { method: "PUT", path: "/roles/:id", permission: "roster:manage" },
  { method: "DELETE", path: "/roles/:id", permission: "roster:manage" },
  { method: "GET", path: "/roles/:id/documents", permission: "roster:read-all" },
  { method: "PUT", path: "/roles/:id/documents", permission: "roster:manage" },
  { method: "GET", path: "/shifts/mine", permission: "roster:read-own" },
  { method: "GET", path: "/shifts", permission: "roster:read-all" },
  { method: "POST", path: "/shifts", permission: "roster:manage" },
  { method: "PUT", path: "/shifts/:id", permission: "roster:manage" },
  { method: "POST", path: "/shifts/:id/cancel", permission: "roster:manage" },
  { method: "GET", path: "/shifts/:id/assignments", permission: "roster:read-all" },
  { method: "POST", path: "/shifts/:id/assignments", permission: "roster:manage" },
  { method: "POST", path: "/assignments/:id/respond", permission: "roster:read-own" },
  { method: "DELETE", path: "/assignments/:id", permission: "roster:manage" },
  { method: "GET", path: "/availability/mine", permission: "roster:read-own" },
  { method: "GET", path: "/availability", permission: "roster:read-all" },
  { method: "POST", path: "/availability", permission: "roster:read-own" },
  { method: "PUT", path: "/availability/:id", permission: "roster:read-own" },
  { method: "DELETE", path: "/availability/:id", permission: "roster:read-own" },
  { method: "GET", path: "/public-holidays", permission: "roster:manage" },
  { method: "POST", path: "/public-holidays", permission: "roster:manage" },
  { method: "DELETE", path: "/public-holidays/:id", permission: "roster:manage" },
  { method: "POST", path: "/publish", permission: "roster:publish" },
];

const ALL_KEYS = ["roster:read-own", "roster:read-all", "roster:manage", "roster:publish"];

describe("roster routes — permission boundary", () => {
  it("every route is wired (a path typo would silently 404 in prod)", () => {
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

  it.each(ROUTES.filter((r) => r.permission === "roster:manage"))(
    "$method $path → 403 for a staff member (roster:read-own is NOT enough to manage)",
    ({ method, path }) => {
      const { status } = runGates(layerFor(method, path), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["roster:read-own"],
      });
      expect(status).toBe(403);
    },
  );

  it.each(ROUTES.filter((r) => r.permission === "roster:publish"))(
    "$method $path → 403 for a manager (roster:manage is NOT enough to publish)",
    ({ method, path }) => {
      const { status } = runGates(layerFor(method, path), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["roster:manage"],
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
