import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import workforceRouter from "./workforce.js";

/**
 * Permission-boundary tests for Workforce Optimisation routes (Phase 3).
 *
 * Hiding a nav item is never access control — the server route is the
 * security boundary. These tests assert the ACTUAL middleware wired onto
 * each route, not `requirePermission` in isolation. Copied structurally
 * from rosterPermissions.test.ts.
 *
 * Hermetic: the permission gate never touches the DB or the controllers, so
 * this runs in the main CI job.
 */

type Handler = (req: Request, res: Response, next: () => void) => void;

function layerFor(method: string, path: string): Handler[] {
  const layer = (workforceRouter as any).stack.find(
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
  { method: "GET", path: "/demand", permission: "roster:read-all" },
  { method: "GET", path: "/coverage", permission: "roster:read-all" },
  { method: "POST", path: "/swaps", permission: "roster:read-own" },
  { method: "GET", path: "/swaps", permission: "roster:read-own" },
  { method: "POST", path: "/swaps/:id/claim", permission: "roster:read-own" },
  { method: "POST", path: "/swaps/:id/cancel", permission: "roster:read-own" },
];

const ALL_KEYS = ["roster:read-own", "roster:read-all", "roster:manage", "roster:publish"];

describe("workforce routes — permission boundary", () => {
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

  it("introduces no new permission key — no seed change, no prod backfill", () => {
    for (const r of ROUTES) {
      expect(ALL_KEYS, `${r.method} ${r.path} uses an unknown key`).toContain(r.permission);
    }
  });
});
