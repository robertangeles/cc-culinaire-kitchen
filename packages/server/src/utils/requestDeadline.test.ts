import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Response } from "express";
import { requestDeadline, afterDeadline } from "./requestDeadline.js";
import { AppError } from "./appError.js";

/** A response that has or has not finished when its socket closes. */
function fakeRes() {
  const res = Object.assign(new EventEmitter(), { writableFinished: false });
  return res as unknown as Response & EventEmitter & { writableFinished: boolean };
}

describe("requestDeadline", () => {
  it("is not aborted while the client waits", () => {
    const d = requestDeadline(fakeRes(), 1000);
    expect(d.signal.aborted).toBe(false);
    expect(d.clientGone).toBe(false);
  });

  it("aborts, and says the client is gone, when the connection closes before the answer finished", () => {
    const res = fakeRes();
    const d = requestDeadline(res, 1000);
    res.emit("close");
    expect(d.signal.aborted).toBe(true);
    expect(d.clientGone).toBe(true);
  });

  it("does not abort when the connection closes after the answer finished (the normal close)", () => {
    const res = fakeRes();
    const d = requestDeadline(res, 1000);
    res.writableFinished = true;
    res.emit("close");
    expect(d.signal.aborted).toBe(false);
  });

  it("aborts on its own after the time limit, with the client still there", () => {
    vi.useFakeTimers();
    try {
      const d = requestDeadline(fakeRes(), 1000);
      vi.advanceTimersByTime(1001);
      expect(d.signal.aborted).toBe(true);
      expect(d.clientGone).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("afterDeadline", () => {
  it("is null when nobody is waiting for the answer", () => {
    const res = fakeRes();
    const d = requestDeadline(res, 1000);
    res.emit("close");
    expect(afterDeadline(new Error("aborted"), d)).toBeNull();
  });

  it("is a 504 AI_TIMEOUT when the time ran out", () => {
    vi.useFakeTimers();
    try {
      const d = requestDeadline(fakeRes(), 1000);
      vi.advanceTimersByTime(1001);
      expect(afterDeadline(new Error("aborted"), d)).toMatchObject({ statusCode: 504, code: "AI_TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a 503 AI_UNAVAILABLE that does not repeat the provider's words when the model failed", () => {
    const sent = afterDeadline(new Error("401 Unauthorized: invalid API key sk-live-123"), requestDeadline(fakeRes(), 1000)) as Error;
    expect(sent).toMatchObject({ statusCode: 503, code: "AI_UNAVAILABLE" });
    expect(sent.message).not.toMatch(/key|sk-live|401/i);
  });

  it("keeps an error a service already gave a status and a code", () => {
    const refused = new AppError(404, "NOT_FOUND", "Recipe not found.");
    expect(afterDeadline(refused, requestDeadline(fakeRes(), 1000))).toBe(refused);
  });
});
