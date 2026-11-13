import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/userService.js", () => ({
  changePassword: vi.fn(),
  PasswordChangeError: class PasswordChangeError extends Error {},
}));
vi.mock("../services/userAnonymisationService.js", () => ({ anonymiseUser: vi.fn(), UserAnonymisationError: class extends Error {} }));
vi.mock("../services/organisationService.js", () => ({}));
vi.mock("../services/emailService.js", () => ({}));

import { handleChangePassword } from "./userController.js";
import { changePassword, PasswordChangeError } from "../services/userService.js";

function run(body: unknown, cookies?: Record<string, string>) {
  const req = { body, cookies, user: { sub: 5 } } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json } as unknown as Response;
  return { req, res, status, json, next: vi.fn() };
}

describe("handleChangePassword", () => {
  beforeEach(() => {
    vi.mocked(changePassword).mockReset();
  });

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

  it("keeps the session named in the body when there is no cookie (a bearer client)", async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    const { req, res, next } = run({ currentPassword: "old-pass", newPassword: "new-password-1", refreshToken: "raw-body" });
    await handleChangePassword(req, res, next);
    expect(changePassword).toHaveBeenCalledWith(5, "old-pass", "new-password-1", "raw-body");
  });

  it("prefers the cookie over a body token", async () => {
    vi.mocked(changePassword).mockResolvedValue(undefined);
    const { req, res, next } = run({ currentPassword: "old-pass", newPassword: "new-password-1", refreshToken: "raw-body" }, { refresh_token: "raw-cookie" });
    await handleChangePassword(req, res, next);
    expect(changePassword).toHaveBeenCalledWith(5, "old-pass", "new-password-1", "raw-cookie");
  });

  it("answers 400 with the message for a refusal the user can act on", async () => {
    vi.mocked(changePassword).mockRejectedValue(new PasswordChangeError("Current password is incorrect."));
    const { req, res, status, json, next } = run({ currentPassword: "bad", newPassword: "new-password-1" });
    await handleChangePassword(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "Current password is incorrect." });
    expect(next).not.toHaveBeenCalled();
  });

  it("hands a server fault to the error handler and never sends its text to the client", async () => {
    const fault = new Error('connection to "db.internal:5432" refused');
    vi.mocked(changePassword).mockRejectedValue(fault);
    const { req, res, status, next } = run({ currentPassword: "old-pass", newPassword: "new-password-1" });
    await handleChangePassword(req, res, next);
    expect(next).toHaveBeenCalledWith(fault);
    expect(status).not.toHaveBeenCalled();
  });

  it("answers 400 and changes nothing for a too-short new password", async () => {
    const { req, res, status, next } = run({ currentPassword: "old-pass", newPassword: "short" });
    await handleChangePassword(req, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(changePassword).not.toHaveBeenCalled();
  });
});
