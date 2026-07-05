import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { brainRouter } from "./brain.js";

/**
 * Enforcement tests for the "Your Brain" routes
 * (docs/specs/brain-memory.md T10 — route auth matrix).
 *
 * These assert the ACTUAL middleware wired onto each route (pattern:
 * navPermissions.test.ts / inventory.test.ts) — importing the router is
 * hermetic: only the gates run, never the controllers, so no DB opens.
 *
 * Each route's stack is [authenticate, gate, controller]; the permission or
 * role gate is the second layer.
 */

type Method = "get" | "delete";
type Gate = (req: Request, res: Response, next: () => void) => void;

/** Returns the gate middleware (2nd layer) for a route+method. */
function findGate(method: Method, path: string): Gate {
  const layer = (brainRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[1].handle as Gate;
}

/** Runs a gate; reports whether it passed and any rejection status. */
function runGate(gate: Gate, user: { permissions: string[]; roles?: string[] } | undefined) {
  const req = {
    user: user ? { sub: 1, roles: user.roles ?? [], permissions: user.permissions } : undefined,
  } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  gate(req, res, next);
  return { passed: next.mock.calls.length > 0, status };
}

describe("brain route enforcement", () => {
  describe("GET /memories (brain:read)", () => {
    const gate = () => findGate("get", "/memories");

    it("allows a user holding brain:read", () => {
      const { passed } = runGate(gate(), { permissions: ["brain:read"] });
      expect(passed).toBe(true);
    });

    it("403s an authenticated user WITHOUT brain:read", () => {
      const { passed, status } = runGate(gate(), { permissions: ["chat:access"] });
      expect(passed).toBe(false);
      expect(status).toHaveBeenCalledWith(403);
    });

    it("401s with no authenticated user", () => {
      const { passed, status } = runGate(gate(), undefined);
      expect(passed).toBe(false);
      expect(status).toHaveBeenCalledWith(401);
    });

    it("allows an Administrator with no explicit permission (superuser bypass)", () => {
      const { passed } = runGate(gate(), { permissions: [], roles: ["Administrator"] });
      expect(passed).toBe(true);
    });
  });

  describe("DELETE /memories/:id (brain:manage)", () => {
    const gate = () => findGate("delete", "/memories/:id");

    it("allows a user holding brain:manage", () => {
      const { passed } = runGate(gate(), { permissions: ["brain:manage"] });
      expect(passed).toBe(true);
    });

    it("403s a user holding only brain:read", () => {
      const { passed, status } = runGate(gate(), { permissions: ["brain:read"] });
      expect(passed).toBe(false);
      expect(status).toHaveBeenCalledWith(403);
    });

    it("401s with no authenticated user", () => {
      const { passed, status } = runGate(gate(), undefined);
      expect(passed).toBe(false);
      expect(status).toHaveBeenCalledWith(401);
    });
  });

  describe("GET /stats (Administrator only)", () => {
    const gate = () => findGate("get", "/stats");

    it("allows an Administrator", () => {
      const { passed } = runGate(gate(), { permissions: [], roles: ["Administrator"] });
      expect(passed).toBe(true);
    });

    it("403s a non-admin even with both brain permissions", () => {
      const { passed, status } = runGate(gate(), {
        permissions: ["brain:read", "brain:manage"],
        roles: ["Subscriber"],
      });
      expect(passed).toBe(false);
      expect(status).toHaveBeenCalledWith(403);
    });
  });
});
