import { describe, it, expect, vi } from "vitest";

const refusal = new Error("refused");
vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(),
  assertLocationAccess: vi.fn(async (_user: unknown, locId: string) => {
    if (locId === "other") throw refusal;
  }),
}));

import inventoryRouter from "./inventory.js";
import { menuIntelligenceRouter } from "./menuIntelligence.js";
import { locationParamGuard } from "../middleware/locationAccess.js";

/**
 * Every `/locations/:locId/...` route must pass through the location guard, so a route added
 * later cannot forget the "assigned to this user" check. The access rule itself is tested in
 * locationAccess.integration.test.ts.
 */
describe("location guard on :locId routes", () => {
  it.each([
    ["inventory", inventoryRouter],
    ["menu intelligence", menuIntelligenceRouter],
  ])("%s router guards :locId", (_name, router) => {
    expect((router as unknown as { params: Record<string, unknown[]> }).params.locId).toContain(locationParamGuard);
  });

  const run = async (locId: string) => {
    const next = vi.fn();
    await locationParamGuard({ user: { sub: 1, roles: [], permissions: [] } } as never, {} as never, next, locId, "locId");
    return next;
  };

  it("lets an allowed location through", async () => {
    expect(await run("mine")).toHaveBeenCalledWith();
  });

  it("hands a refusal to the error handler", async () => {
    expect(await run("other")).toHaveBeenCalledWith(refusal);
  });
});
