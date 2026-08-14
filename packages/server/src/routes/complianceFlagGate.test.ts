import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Proves the compliance_enabled retrofit is actually wired onto the router,
 * in the right order, not just written and unused.
 *
 * requireFlag's own logic (true/false/absent/error-fails-closed) is unit
 * tested in isolation in middleware/requireFlag.test.ts — this file tests
 * placement: is a flag gate mounted at all, and does it run BEFORE
 * authenticate, so a flagged-off route 404s an unauthenticated prober too
 * rather than only an authenticated one.
 *
 * Hits real router internals (Router.stack), so this is a wiring test, not a
 * behavioural one — deliberately narrow, matching compliancePermissions.test.ts's
 * own "walk the actual middleware stack" approach for the same reason: a
 * refactor that drops or reorders the gate should fail here, not in prod.
 */

let mockSettings: Record<string, string> = {};
vi.mock("../services/settingsService.js", () => ({
  getAllSettings: vi.fn(async () => mockSettings),
}));

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("compliance router — compliance_enabled flag gate placement", () => {
  beforeEach(() => {
    mockSettings = {};
    vi.resetModules();
  });

  it("mounts a router-level gate strictly before authenticate", async () => {
    const complianceRouter = (await import("./compliance.js")).default;
    const { authenticate } = await import("../middleware/auth.js");

    const useLayers = (complianceRouter as any).stack.filter((l: any) => !l.route);
    const authenticateIndex = useLayers.findIndex((l: any) => l.handle === authenticate);
    expect(authenticateIndex).toBeGreaterThan(-1);
    // At least one router-level middleware runs before it — requireFlag,
    // confirmed by behaviour (not name — requireFlag returns an anonymous
    // closure) in the next two tests.
    expect(authenticateIndex).toBeGreaterThan(0);
  });

  it("the gate ahead of authenticate 404s when compliance_enabled is not \"true\"", async () => {
    const complianceRouter = (await import("./compliance.js")).default;
    const { authenticate } = await import("../middleware/auth.js");
    mockSettings = { compliance_enabled: "false" };

    const useLayers = (complianceRouter as any).stack.filter((l: any) => !l.route);
    const authenticateIndex = useLayers.findIndex((l: any) => l.handle === authenticate);
    const gate = useLayers[authenticateIndex - 1].handle;

    const res = mockRes();
    const next = vi.fn();
    await gate({} as Request, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("the gate ahead of authenticate calls next() when compliance_enabled is \"true\" — the live-prod regression guard", async () => {
    const complianceRouter = (await import("./compliance.js")).default;
    const { authenticate } = await import("../middleware/auth.js");
    mockSettings = { compliance_enabled: "true" };

    const useLayers = (complianceRouter as any).stack.filter((l: any) => !l.route);
    const authenticateIndex = useLayers.findIndex((l: any) => l.handle === authenticate);
    const gate = useLayers[authenticateIndex - 1].handle;

    const res = mockRes();
    const next = vi.fn();
    await gate({} as Request, res, next);

    // This is the assertion that matters most: Phase 1 compliance is already
    // live, so the retrofit must be a no-op for every existing installation
    // that already has (or will be backfilled to have) this flag "true".
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
