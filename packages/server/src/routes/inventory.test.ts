import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import router from "./inventory.js";

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
