import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { menuIntelligenceRouter } from "./menuIntelligence.js";
import { wasteRouter } from "./waste.js";
import { prepRouter } from "./prep.js";

/**
 * Enforcement regression tests for the role-aware nav change.
 *
 * Menu & Costing, Waste, and Prep were `authenticate`-only; this change gates
 * each whole module on a permission via `router.use(requirePermission(...))`.
 * These tests assert the ACTUAL middleware wired onto each router (not
 * `requirePermission` in isolation), so a future refactor that drops the gate
 * fails here. Importing the router is hermetic: the permission gate never
 * touches the DB or the controllers.
 *
 * Each router's `.use()` stack is [authenticate, requirePermission(...)]; the
 * permission gate is the second use-layer.
 */

type Gate = (req: Request, res: Response, next: () => void) => void;

/** Returns the permission-gate middleware (2nd router-level `.use`). */
function permissionGate(router: unknown): Gate {
  const useLayers = (router as any).stack.filter((l: any) => !l.route);
  if (useLayers.length < 2) {
    throw new Error(`expected [authenticate, requirePermission] use-layers, got ${useLayers.length}`);
  }
  return useLayers[1].handle as Gate;
}

/** Runs a gate; reports whether it passed and the status set on rejection. */
function runGate(gate: Gate, user: { permissions: string[]; roles?: string[] } | undefined) {
  const req = { user: user ? { sub: 1, roles: user.roles ?? [], permissions: user.permissions } : undefined } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  gate(req, res, next);
  return { passed: next.mock.calls.length > 0, status };
}

const CASES: Array<{ name: string; router: unknown; perm: string }> = [
  { name: "Menu & Costing", router: menuIntelligenceRouter, perm: "menu:read" },
  { name: "Waste", router: wasteRouter, perm: "waste:read" },
  { name: "Prep", router: prepRouter, perm: "prep:manage" },
];

describe("nav module permission enforcement", () => {
  for (const { name, router, perm } of CASES) {
    describe(name, () => {
      it(`allows a user holding ${perm} (200 path)`, () => {
        const { passed, status } = runGate(permissionGate(router), { permissions: [perm] });
        expect(passed).toBe(true);
        expect(status).not.toHaveBeenCalled();
      });

      it(`403s an authenticated user WITHOUT ${perm}`, () => {
        const { passed, status } = runGate(permissionGate(router), { permissions: ["chat:access"] });
        expect(passed).toBe(false);
        expect(status).toHaveBeenCalledWith(403);
      });

      it("401s a request with no authenticated user", () => {
        const { passed, status } = runGate(permissionGate(router), undefined);
        expect(passed).toBe(false);
        expect(status).toHaveBeenCalledWith(401);
      });

      it("allows an Administrator with no explicit permission (superuser bypass)", () => {
        const { passed, status } = runGate(permissionGate(router), { permissions: [], roles: ["Administrator"] });
        expect(passed).toBe(true);
        expect(status).not.toHaveBeenCalled();
      });
    });
  }
});
