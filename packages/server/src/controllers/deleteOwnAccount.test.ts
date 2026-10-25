import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/accountDeletionService.js", async () => {
  const actual = await vi.importActual<typeof import("../services/accountDeletionService.js")>("../services/accountDeletionService.js");
  return { ...actual, deleteOwnAccount: vi.fn() };
});

import { AccountDeletionError, deleteOwnAccount } from "../services/accountDeletionService.js";
import { UserAnonymisationError } from "../services/userAnonymisationService.js";
import { handleDeleteOwnAccount } from "./userController.js";
import usersRouter from "../routes/users.js";

function fakeRes() {
  const res = { status: vi.fn(), json: vi.fn(), clearCookie: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
const call = (body: unknown) => {
  const res = fakeRes();
  const next = vi.fn();
  const req = { user: { sub: 5 }, body } as unknown as Request;
  return handleDeleteOwnAccount(req, res as unknown as Response, next).then(() => ({ res, next }));
};

beforeEach(() => {
  vi.mocked(deleteOwnAccount).mockReset();
});

describe("POST /api/users/delete-account handler", () => {
  it("deletes the caller's own account (from the token, never from the body) and signs them out", async () => {
    vi.mocked(deleteOwnAccount).mockResolvedValue(undefined);
    const { res } = await call({ password: "pw", userId: 999 });
    expect(deleteOwnAccount).toHaveBeenCalledWith(5, { password: "pw" });
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(res.clearCookie).toHaveBeenCalledWith("access_token", { path: "/" });
    expect(res.clearCookie).toHaveBeenCalledWith("refresh_token", { path: "/" });
  });

  it("returns the service's status and code when the request is refused, without signing out", async () => {
    vi.mocked(deleteOwnAccount).mockRejectedValue(new AccountDeletionError("Incorrect password.", "INVALID_CREDENTIALS", 403));
    const { res } = await call({ password: "bad" });
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Incorrect password.", code: "INVALID_CREDENTIALS" });
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("returns 409 when blocked by organisation ownership", async () => {
    vi.mocked(deleteOwnAccount).mockRejectedValue(new AccountDeletionError("x", "OWNERSHIP_TRANSFER_REQUIRED", 409));
    const { res } = await call({ password: "pw" });
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 502 when the subscription could not be cancelled", async () => {
    vi.mocked(deleteOwnAccount).mockRejectedValue(new UserAnonymisationError("Could not cancel."));
    const { res } = await call({ password: "pw" });
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("rejects malformed input with 400 and does not call the service", async () => {
    const { res } = await call({ password: 12345 });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });

  it("passes unexpected errors to next()", async () => {
    const boom = new Error("db down");
    vi.mocked(deleteOwnAccount).mockRejectedValue(boom);
    const { next } = await call({ password: "pw" });
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("delete-account route wiring", () => {
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown; name: string }[] }; name: string };
  const layers = (usersRouter as unknown as { stack: Layer[] }).stack;

  it("sits behind authenticate and is rate limited", () => {
    expect(layers[0].name).toBe("authenticate");
    const route = layers.find((l) => l.route?.path === "/delete-account")?.route;
    expect(route?.methods.post).toBe(true);
    expect(route?.stack).toHaveLength(2); // [authRateLimit, handleDeleteOwnAccount]
  });

  it("is registered before the /:id routes so it is not swallowed by them", () => {
    const paths = layers.filter((l) => l.route).map((l) => l.route!.path);
    expect(paths.indexOf("/delete-account")).toBeLessThan(paths.indexOf("/:id"));
  });
});
