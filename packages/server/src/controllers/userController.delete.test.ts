import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/userAnonymisationService.js", () => {
  class UserAnonymisationError extends Error {}
  return { anonymiseUser: vi.fn(), UserAnonymisationError };
});
vi.mock("../services/userService.js", () => ({}));
vi.mock("../services/organisationService.js", () => ({}));
vi.mock("../services/emailService.js", () => ({}));

import { handleDeleteUser } from "./userController.js";
import { anonymiseUser, UserAnonymisationError } from "../services/userAnonymisationService.js";

function run(userIdParam: string, actorId = 1) {
  const req = { params: { id: userIdParam }, user: { sub: actorId } } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  return { req, res, status, json, next };
}

describe("handleDeleteUser", () => {
  beforeEach(() => {
    vi.mocked(anonymiseUser).mockReset();
  });

  it("anonymises the user, recording who did it, and answers success", async () => {
    vi.mocked(anonymiseUser).mockResolvedValue(undefined);
    const { req, res, json, next } = run("7", 1);
    await handleDeleteUser(req, res, next);
    expect(anonymiseUser).toHaveBeenCalledWith(7, 1);
    expect(json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses to delete your own account with 400", async () => {
    const { req, res, status, next } = run("1", 1);
    await handleDeleteUser(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(anonymiseUser).not.toHaveBeenCalled();
  });

  it("answers 404 when the user does not exist", async () => {
    vi.mocked(anonymiseUser).mockRejectedValue(new Error("User not found"));
    const { req, res, status, json, next } = run("999", 1);
    await handleDeleteUser(req, res, next);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "User not found" });
  });

  it("answers 502 with a clear message when the Stripe subscription could not be cancelled", async () => {
    vi.mocked(anonymiseUser).mockRejectedValue(new UserAnonymisationError("Could not cancel the user's subscription"));
    const { req, res, status, json, next } = run("7", 1);
    await handleDeleteUser(req, res, next);
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({ error: "Could not cancel the user's subscription" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes any other failure to the error handler", async () => {
    const boom = new Error("db down");
    vi.mocked(anonymiseUser).mockRejectedValue(boom);
    const { req, res, next } = run("7", 1);
    await handleDeleteUser(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
