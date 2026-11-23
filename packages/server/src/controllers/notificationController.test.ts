import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/notificationService.js", () => ({ markAsRead: vi.fn(), dismiss: vi.fn() }));

import { handleMarkAsRead, handleDismiss } from "./notificationController.js";
import { markAsRead, dismiss } from "../services/notificationService.js";

function run() {
  const req = { params: { id: "n-1" }, user: { sub: 5 } } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { req, res: { status, json } as unknown as Response, status, json, next: vi.fn() };
}

// Another person's notification and a missing one look the same: 404 NOT_FOUND, so the phone can drop it.
describe.each([
  ["handleMarkAsRead", handleMarkAsRead, markAsRead],
  ["handleDismiss", handleDismiss, dismiss],
] as const)("%s", (_name, handler, service) => {
  it("answers 404 NOT_FOUND when the notification is not the caller's", async () => {
    vi.mocked(service).mockResolvedValue(undefined as never);
    const { req, res, status, json, next } = run();
    await handler(req, res, next);
    expect(service).toHaveBeenCalledWith("n-1", 5);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ error: "Notification not found", code: "NOT_FOUND" });
  });
});
