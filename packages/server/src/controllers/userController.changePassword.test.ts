import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/userService.js", () => ({ changePassword: vi.fn() }));
vi.mock("../services/userAnonymisationService.js", () => ({ anonymiseUser: vi.fn(), UserAnonymisationError: class extends Error {} }));
vi.mock("../services/organisationService.js", () => ({}));
vi.mock("../services/emailService.js", () => ({}));

import { handleChangePassword } from "./userController.js";
import { changePassword } from "../services/userService.js";

function run(body: unknown, cookies?: Record<string, string>) {
  const req = { body, cookies, user: { sub: 5 } } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json, next: vi.fn() };
}

describe("handleChangePassword", () => {
  beforeEach(() => vi.mocked(changePassword).mockReset());

  it("hands the caller's refresh cookie to the service so their own session survives", async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    const { req, res, json, next } = run({ currentPassword: "old-pass", newPassword: "new-password-1" }, { refresh_token: "raw-cookie" });
    await handleChangePassword(req, res, next);
    expect(changePassword).toHaveBeenCalledWith(5, "old-pass", "new-password-1", "raw-cookie");
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it("passes no session when the request carries no cookie (a bearer client)", async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    const { req, res, next } = run({ currentPassword: "old-pass", newPassword: "new-password-1" });
    await handleChangePassword(req, res, next);
    expect(changePassword).toHaveBeenCalledWith(5, "old-pass", "new-password-1", undefined);
  });

  it("answers 400 and changes nothing for a too-short new password", async () => {
    const { req, res, status, next } = run({ currentPassword: "old-pass", newPassword: "short" });
    await handleChangePassword(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(changePassword).not.toHaveBeenCalled();
  });
});
