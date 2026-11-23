import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// First run on the phone: join an organisation by its key, then a location by its store key. The phone branches on `code`, never on the sentence.
vi.mock("../services/organisationService.js", async () => {
  const actual = await vi.importActual<typeof import("../services/organisationService.js")>("../services/organisationService.js");
  return { ...actual, joinOrganisation: vi.fn() };
});
vi.mock("../services/storeLocationService.js", async () => {
  const actual = await vi.importActual<typeof import("../services/storeLocationService.js")>("../services/storeLocationService.js");
  return { ...actual, joinStoreLocation: vi.fn() };
});

import { joinOrganisation } from "../services/organisationService.js";
import { joinStoreLocation } from "../services/storeLocationService.js";
import { JoinError } from "../services/joinErrors.js";
import { handleJoinOrganisation } from "./organisationController.js";
import { handleJoinStoreLocation } from "./storeLocationController.js";

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
const run = async (handler: (req: Request, res: Response, next: () => void) => Promise<void>, body: unknown) => {
  const res = fakeRes();
  const next = vi.fn();
  await handler({ user: { sub: 5 }, body } as unknown as Request, res as unknown as Response, next);
  return { res, next };
};

beforeEach(() => {
  vi.mocked(joinOrganisation).mockReset();
  vi.mocked(joinStoreLocation).mockReset();
});

describe("POST /api/organisations/join", () => {
  it("joins as the caller from the token and answers with the organisation", async () => {
    vi.mocked(joinOrganisation).mockResolvedValue({ organisationId: 1 } as never);
    const { res } = await run(handleJoinOrganisation, { joinKey: "CULINAIRE-ABC" });
    expect(joinOrganisation).toHaveBeenCalledWith(5, "CULINAIRE-ABC");
    expect(res.json).toHaveBeenCalledWith({ organisation: { organisationId: 1 } });
  });

  it.each([
    ["INVALID_JOIN_KEY", "Invalid join key."],
    ["ALREADY_MEMBER", "You are already a member of this organisation."],
  ] as const)("answers 400 with the code %s and the sentence (the web reads the sentence)", async (code, message) => {
    vi.mocked(joinOrganisation).mockRejectedValue(new JoinError(message, code, 400));
    const { res } = await run(handleJoinOrganisation, { joinKey: "x" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: message, code });
  });

  it("is a server error, not a 400, when something other than a refusal fails (a database problem is not the person's key)", async () => {
    const boom = new Error("connection reset");
    vi.mocked(joinOrganisation).mockRejectedValue(boom);
    const { res, next } = await run(handleJoinOrganisation, { joinKey: "x" });
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a body with no key", async () => {
    const { res } = await run(handleJoinOrganisation, {});
    expect(res.status).toHaveBeenCalledWith(400);
    expect(joinOrganisation).not.toHaveBeenCalled();
  });
});

describe("POST /api/store-locations/join", () => {
  it.each([
    ["STORE_KEY_NOT_FOUND", "Store key not found.", 404],
    ["NOT_ORG_MEMBER", "You must be a member of this organisation first.", 403],
    ["ALREADY_ASSIGNED", "You are already assigned to this location.", 409],
    ["LOCATION_INACTIVE", "This location is no longer active.", 400],
  ] as const)("answers %s with its status and code", async (code, message, status) => {
    vi.mocked(joinStoreLocation).mockRejectedValue(new JoinError(message, code, status));
    const { res } = await run(handleJoinStoreLocation, { storeKey: "KITCHEN-X" });
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ error: message, code });
  });

  it("joins as the caller from the token", async () => {
    vi.mocked(joinStoreLocation).mockResolvedValue({ storeLocationId: "L1" } as never);
    const { res } = await run(handleJoinStoreLocation, { storeKey: "KITCHEN-X" });
    expect(joinStoreLocation).toHaveBeenCalledWith(5, "KITCHEN-X");
    expect(res.json).toHaveBeenCalledWith({ storeLocation: { storeLocationId: "L1" } });
  });

  it("is a server error when something other than a refusal fails", async () => {
    const boom = new Error("connection reset");
    vi.mocked(joinStoreLocation).mockRejectedValue(boom);
    const { next } = await run(handleJoinStoreLocation, { storeKey: "KITCHEN-X" });
    expect(next).toHaveBeenCalledWith(boom);
  });
});
