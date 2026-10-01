import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import inventoryRouter from "./inventory.js";

/**
 * Permission-boundary tests for the Front-of-House routes.
 *
 * Each FOH route is gated per-route with `requirePermission("sales:record")`
 * or `requirePermission("sales:read")`. These tests pull the ACTUAL gate
 * middleware off the router's route stack (not requirePermission in isolation),
 * so a future edit that drops or weakens a gate fails here. requirePermission
 * self-handles 401 (no user), the Administrator superuser bypass, and 403, so
 * the gate can be exercised without the DB or the auth layer.
 */

type Gate = (req: Request, res: Response, next: () => void) => void;

/** Find the per-route permission gate for a given METHOD + path on a router. */
function routeGate(router: unknown, method: string, path: string): Gate {
  const layer = (router as any).stack.find(
    (l: any) => l.route && l.route.path === path && l.route.methods?.[method.toLowerCase()],
  );
  if (!layer) throw new Error(`route not found: ${method} ${path}`);
  // route.stack = [requirePermission(...), controllerHandler]; the gate is first.
  const gate = layer.route.stack[0]?.handle as Gate | undefined;
  if (!gate) throw new Error(`no gate middleware on ${method} ${path}`);
  return gate;
}

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

const CASES: Array<{ name: string; method: string; path: string; perm: string }> = [
  { name: "FOH shelf view", method: "get", path: "/locations/:locId/foh", perm: "sales:record" },
  { name: "restock FOH", method: "post", path: "/locations/:locId/foh/restock", perm: "sales:record" },
  { name: "restock suggestions", method: "get", path: "/locations/:locId/foh/restock-suggestions", perm: "sales:record" },
  { name: "count FOH", method: "post", path: "/locations/:locId/foh/count", perm: "sales:record" },
  { name: "log FOH waste", method: "post", path: "/locations/:locId/foh/waste", perm: "sales:record" },
  { name: "record sales", method: "post", path: "/locations/:locId/sales", perm: "sales:record" },
  { name: "list sales", method: "get", path: "/locations/:locId/foh/sales", perm: "sales:read" },
  { name: "sales report", method: "get", path: "/locations/:locId/foh/sales-report", perm: "sales:read" },
];

describe("FOH route permission enforcement", () => {
  for (const { name, method, path, perm } of CASES) {
    describe(`${name} (${method.toUpperCase()} ${path})`, () => {
      it(`allows a user holding ${perm}`, () => {
        const { passed, status } = runGate(routeGate(inventoryRouter, method, path), { permissions: [perm] });
        expect(passed).toBe(true);
        expect(status).not.toHaveBeenCalled();
      });

      it(`403s an authenticated user WITHOUT ${perm}`, () => {
        const { passed, status } = runGate(routeGate(inventoryRouter, method, path), { permissions: ["chat:access"] });
        expect(passed).toBe(false);
        expect(status).toHaveBeenCalledWith(403);
      });

      it("401s a request with no authenticated user", () => {
        const { passed, status } = runGate(routeGate(inventoryRouter, method, path), undefined);
        expect(passed).toBe(false);
        expect(status).toHaveBeenCalledWith(401);
      });

      it("allows an Administrator via superuser bypass", () => {
        const { passed, status } = runGate(routeGate(inventoryRouter, method, path), { permissions: [], roles: ["Administrator"] });
        expect(passed).toBe(true);
        expect(status).not.toHaveBeenCalled();
      });
    });
  }
});
