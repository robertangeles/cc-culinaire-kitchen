import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import complianceRouter from "./compliance.js";
import { isOwnDocument } from "../services/complianceService.js";

/**
 * Permission-boundary tests for the Compliance Vault routes.
 *
 * Hiding a nav item is never access control — the server route is the security
 * boundary. These tests assert the ACTUAL middleware wired onto each route (not
 * `requirePermission` in isolation), so a refactor that drops or downgrades a
 * gate fails here rather than in production.
 *
 * Hermetic: the permission gate never touches the DB or the controllers, so
 * this runs in the main CI job. Copied structurally from
 * storageAreaPermissions.test.ts.
 */

type Handler = (req: Request, res: Response, next: () => void) => void;

/** The middleware stack Express actually wired for `method path`. */
function layerFor(method: string, path: string): Handler[] {
  const layer = (complianceRouter as any).stack.find(
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
  { method: "GET", path: "/documents/mine", permission: "compliance:read-own" },
  { method: "POST", path: "/documents", permission: "compliance:read-own" },
  { method: "GET", path: "/documents/:id", permission: "compliance:read-own" },
  { method: "GET", path: "/staff/:userId/documents", permission: "compliance:read-all" },
  { method: "GET", path: "/dashboard", permission: "compliance:read-all" },
  { method: "GET", path: "/stats", permission: "compliance:read-all" },
  { method: "GET", path: "/pending", permission: "compliance:verify" },
  { method: "POST", path: "/documents/:id/verify", permission: "compliance:verify" },
  { method: "POST", path: "/documents/:id/reject", permission: "compliance:verify" },
  { method: "GET", path: "/rules", permission: "compliance:manage-rules" },
  { method: "PUT", path: "/rules", permission: "compliance:manage-rules" },
  { method: "GET", path: "/required-documents", permission: "compliance:manage-rules" },
  { method: "PUT", path: "/required-documents", permission: "compliance:manage-rules" },
];

const ALL_KEYS = [
  "compliance:read-own",
  "compliance:read-all",
  "compliance:verify",
  "compliance:manage-rules",
];

describe("compliance routes — permission boundary", () => {
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

  it.each(ROUTES.filter((r) => r.permission === "compliance:verify"))(
    "$method $path → 403 for a staff member (compliance:read-own is NOT enough to verify)",
    ({ method, path }) => {
      const { status } = runGates(layerFor(method, path), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["compliance:read-own"],
      });
      expect(status).toBe(403);
    },
  );

  it.each(ROUTES.filter((r) => r.permission === "compliance:manage-rules"))(
    "$method $path → 403 for a verifier (compliance:verify is NOT enough to manage rules)",
    ({ method, path }) => {
      const { status } = runGates(layerFor(method, path), {
        sub: 1,
        roles: ["Subscriber"],
        permissions: ["compliance:verify"],
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

/**
 * GET /documents/:id is gated by `compliance:read-own` alone — the permission
 * gate only proves the caller may read THEIR OWN documents, it says nothing
 * about which document id they typed in. `isOwnDocument` is the guard the
 * controller calls before returning a document; it must never let a caller
 * read a colleague's document by guessing a UUID. Pure — no DB, so it is
 * tested directly here rather than in an integration test.
 */
describe("GET /documents/:id — read-own must never leak a colleague's document by id", () => {
  it("is true only when the document's subject is the caller", () => {
    expect(isOwnDocument({ userId: 42 }, 42)).toBe(true);
  });

  it("is false for a colleague's document in the same org", () => {
    expect(isOwnDocument({ userId: 42 }, 7)).toBe(false);
  });

  it("is false for a venue document (no staff subject at all)", () => {
    expect(isOwnDocument({ userId: null }, 7)).toBe(false);
  });
});
