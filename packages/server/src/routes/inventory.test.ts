import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import router from "./inventory.js";
import { poPdfRateLimit } from "../middleware/rateLimiter.js";

/**
 * Supplier read-gating regression tests.
 *
 * These assert the ACTUAL permission middleware wired onto the supplier
 * routes in this router — not `requirePermission` in isolation. Importing
 * the router is hermetic: `db` is a lazy Proxy, and these tests only run
 * the permission gate, never the controllers, so no DB connection opens.
 *
 * Decision: supplier reads sit on the same basic read tier as ingredient
 * reads (`inventory:count`); writes stay on `inventory:manage`.
 */

type Method = "get" | "post" | "patch" | "put" | "delete";

// Realistic seeded permission tiers (packages/server/src/db/seed.ts).
// Free Subscriber holds the basic read tier but NOT the manage tier.
const SUBSCRIBER = [
  "chat:access",
  "org:create-organisation",
  "inventory:count",
  "purchasing:draft",
  "purchasing:receive",
];
// Paid Subscriber / Administrator additionally hold the manage tier.
const MANAGER = [...SUBSCRIBER, "inventory:manage"];

type Gate = (req: Request, res: Response, next: () => void) => void;

/**
 * Returns the permission-gate middleware attached to a given route+method.
 * Each supplier route's stack is `[requirePermission, controller]`; the gate
 * is the first layer.
 */
function findGate(method: Method, path: string): Gate {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack[0].handle as Gate;
}

/** Runs a gate with the given permissions; reports whether it passed. */
function runGate(gate: Gate, permissions: string[]) {
  const req = { user: { sub: 1, roles: [], permissions } } as unknown as Request;
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  gate(req, res, next);
  return { passed: next.mock.calls.length > 0, status };
}

describe("supplier read-gating", () => {
  it("lets a basic inventory:count user GET /suppliers", () => {
    const { passed, status } = runGate(findGate("get", "/suppliers"), SUBSCRIBER);
    expect(passed).toBe(true);
    expect(status).not.toHaveBeenCalled();
  });

  it("lets a basic inventory:count user GET /suppliers/:id/locations", () => {
    const { passed, status } = runGate(
      findGate("get", "/suppliers/:id/locations"),
      SUBSCRIBER,
    );
    expect(passed).toBe(true);
    expect(status).not.toHaveBeenCalled();
  });

  it("still 403s a basic inventory:count user on supplier writes", () => {
    for (const [method, path] of [
      ["post", "/suppliers"],
      ["patch", "/suppliers/:id"],
      ["delete", "/suppliers/:id"],
    ] as [Method, string][]) {
      const { passed, status } = runGate(findGate(method, path), SUBSCRIBER);
      expect(passed, `${method} ${path} should be blocked`).toBe(false);
      expect(status).toHaveBeenCalledWith(403);
    }
  });

  it("still 403s a user with no inventory permissions on GET /suppliers", () => {
    const { passed, status } = runGate(findGate("get", "/suppliers"), [
      "chat:access",
    ]);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it("leaves existing manage-tier users able to GET and write suppliers", () => {
    expect(runGate(findGate("get", "/suppliers"), MANAGER).passed).toBe(true);
    expect(runGate(findGate("post", "/suppliers"), MANAGER).passed).toBe(true);
    expect(runGate(findGate("delete", "/suppliers/:id"), MANAGER).passed).toBe(true);
  });
});

// The phone's "update to continue" rule sits on sign-in and the count download only, never on count writes.
describe("mobile version policy placement", () => {
  const names = (method: Method, path: string) => (router as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]).route.stack.map((l: any) => l.handle.name || "anonymous");
  it("is on the count download", () => {
    expect(names("get", "/stock-takes/:id/count-sheets").length).toBe(3); // permission, version policy, handler
  });
  it("is not on saving a line or submitting an area, so counts waiting on an old phone can still be sent", () => {
    expect(names("post", "/stock-takes/:id/categories/:cat/lines").length).toBe(2);
    expect(names("post", "/stock-takes/:id/categories/:cat/submit").length).toBe(2);
  });
});

// The phone's pre-count download is a counter-level read: needs inventory:count, nothing more.
describe("stock take count sheets — inventory:count", () => {
  it("403s a user without inventory:count", () => {
    const { passed, status } = runGate(findGate("get", "/stock-takes/:id/count-sheets"), ["chat:access"]);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it("passes a counter (inventory:count)", () => {
    expect(runGate(findGate("get", "/stock-takes/:id/count-sheets"), SUBSCRIBER).passed).toBe(true);
  });
});

// Approving/flagging a stock take and viewing the review + history queues are
// HQ-only (inventory:hq) — a counter or a plain manager must NOT get in.
const HQ = [...MANAGER, "inventory:hq"];

describe("stock-take review + history — inventory:hq only", () => {
  const HQ_ROUTES: [Method, string][] = [
    ["get", "/stock-takes/pending-reviews"],
    ["get", "/stock-takes/history"],
    ["post", "/stock-takes/:id/approve"],
    ["post", "/stock-takes/:id/flag"],
  ];

  it.each(HQ_ROUTES)("403s a counter (inventory:count) on %s %s", (method, path) => {
    const { passed, status } = runGate(findGate(method, path), SUBSCRIBER);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it.each(HQ_ROUTES)("403s a manager WITHOUT inventory:hq on %s %s", (method, path) => {
    const { passed, status } = runGate(findGate(method, path), MANAGER);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it.each(HQ_ROUTES)("passes an inventory:hq user on %s %s", (method, path) => {
    expect(runGate(findGate(method, path), HQ).passed).toBe(true);
  });
});

/**
 * Order-guide gating (Purchasing P1).
 *
 * Deliberately reuses EXISTING permissions rather than minting a new key:
 * ordering from a guide is `purchasing:draft` (if you can draft a PO you can use
 * the guide), while creating/editing/deleting a guide is `inventory:manage`
 * (curating what gets ordered is a catalogue-management action). Reusing keys
 * means no seed entry and no backfill — which is what makes adding these routes
 * safe for existing roles rather than a 403 for everyone.
 */
describe("order-guide gating", () => {
  const READ_ROUTES: [Method, string][] = [
    ["get", "/locations/:locId/order-guides"],
    ["get", "/order-guides/:guideId/items"],
  ];
  const MANAGE_ROUTES: [Method, string][] = [
    ["post", "/locations/:locId/order-guides"],
    ["patch", "/order-guides/:guideId"],
    ["delete", "/order-guides/:guideId"],
    ["put", "/order-guides/:guideId/items"],
  ];

  it.each(READ_ROUTES)("lets a purchasing:draft user %s %s", (method, path) => {
    expect(runGate(findGate(method, path), SUBSCRIBER).passed).toBe(true);
  });

  it.each(READ_ROUTES)("403s a user without purchasing:draft on %s %s", (method, path) => {
    const noPurchasing = ["chat:access", "inventory:count"];
    const { passed, status } = runGate(findGate(method, path), noPurchasing);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it.each(MANAGE_ROUTES)("403s a drafter without inventory:manage on %s %s", (method, path) => {
    const { passed, status } = runGate(findGate(method, path), SUBSCRIBER);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it.each(MANAGE_ROUTES)("passes an inventory:manage user on %s %s", (method, path) => {
    expect(runGate(findGate(method, path), MANAGER).passed).toBe(true);
  });
});

describe("PO send-to-supplier gating", () => {
  const path = "/purchase-orders/:id/send-email";

  it("403s a user without purchasing:submit", () => {
    // MANAGER holds inventory:manage + purchasing:draft but NOT purchasing:submit.
    const { passed, status } = runGate(findGate("post", path), MANAGER);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });

  it("passes a user with purchasing:submit", () => {
    expect(runGate(findGate("post", path), [...MANAGER, "purchasing:submit"]).passed).toBe(true);
  });
});

describe("Wave 5 purchasing routes", () => {
  const hasLayer = (method: Method, path: string) =>
    (router as any).stack.some((l: any) => l.route?.path === path && l.route?.methods?.[method]);

  it("no longer has the legacy line-receive route (it could never succeed; receiving sessions replaced it)", () => {
    expect(hasLayer("post", "/purchase-orders/:id/lines/:lineId/receive")).toBe(false);
  });

  it.each([
    ["get", "/purchase-orders/:id/pdf"],
    ["post", "/purchase-orders/:id/send-email"],
  ] as Array<[Method, string]>)("rate-limits the PDF render per user on %s %s", (method, path) => {
    const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route?.methods?.[method]);
    expect(layer.route.stack.map((s: any) => s.handle)).toContain(poPdfRateLimit);
  });

  it("gates the unresolved-discrepancy list on purchasing:credit", () => {
    const gate = findGate("get", "/credit-notes/unresolved-discrepancies");
    expect(runGate(gate, MANAGER).passed).toBe(false);
    expect(runGate(gate, ["purchasing:credit"]).passed).toBe(true);
  });
});

describe("PO list and detail gating (the receiving queue)", () => {
  const RECEIVE_ONLY = ["purchasing:receive"]; // a custom BOH role with no inventory:count
  const routes: Array<[Method, string]> = [
    ["get", "/purchase-orders"],
    ["get", "/purchase-orders/:id"],
  ];

  it.each(routes)("lets a purchasing:receive-only user through on %s %s", (method, path) => {
    expect(runGate(findGate(method, path), RECEIVE_ONLY).passed).toBe(true);
  });

  it.each(routes)("still passes an inventory:count user on %s %s", (method, path) => {
    expect(runGate(findGate(method, path), SUBSCRIBER).passed).toBe(true);
  });

  it.each(routes)("403s a user with neither inventory:count nor purchasing:receive on %s %s", (method, path) => {
    const { passed, status } = runGate(findGate(method, path), ["chat:access"]);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });
});

describe("GET /catalog-requests/mine gating", () => {
  it("passes anyone who may make a request (inventory:count)", () => {
    expect(runGate(findGate("get", "/catalog-requests/mine"), ["inventory:count"]).passed).toBe(true);
  });

  it("403s a user without inventory:count", () => {
    const { passed, status } = runGate(findGate("get", "/catalog-requests/mine"), ["chat:access"]);
    expect(passed).toBe(false);
    expect(status).toHaveBeenCalledWith(403);
  });
});
