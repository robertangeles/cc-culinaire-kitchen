import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { errorHandler } from "./errorHandler.js";
import { PromptIsDeviceOnlyError } from "../errors/promptErrors.js";

/** Creates a mock Express response. */
function mockRes(overrides: Partial<Response> = {}): Response {
  const res = {
    headersSent: false,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    ...overrides,
  } as unknown as Response;
  return res;
}

const mockReq = {} as Request;
const mockNext: NextFunction = vi.fn();

describe("errorHandler", () => {
  it("returns 400 for ZodError", () => {
    const err = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        received: "number",
        path: ["name"],
        message: "Expected string",
      },
    ]);
    const res = mockRes();

    errorHandler(err, mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation error" }),
    );
  });

  it("returns 502 for AI provider errors", () => {
    const res = mockRes();

    errorHandler(new Error("Invalid API key provided"), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("AI provider") }),
    );
  });

  it("returns 502 for PromptIsDeviceOnlyError (foot-gun catch)", () => {
    // The runtime guard throws this when a server code path tries to invoke
    // a device-only prompt. The error handler must map it to 502 (not 500)
    // so monitoring can distinguish the misconfiguration from a generic
    // crash, and the response body must surface the offending promptKey so
    // an admin can find which prompt is mis-flagged without trawling logs.
    const res = mockRes();

    errorHandler(
      new PromptIsDeviceOnlyError("antoine-system-prompt"),
      mockReq,
      res,
      mockNext,
    );

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("on-device runtime"),
        promptKey: "antoine-system-prompt",
      }),
    );
  });

  it("returns 500 for generic errors", () => {
    const res = mockRes();

    errorHandler(new Error("Something broke"), mockReq, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
  });

  it("does nothing when headers already sent", () => {
    const res = mockRes({ headersSent: true });

    errorHandler(new Error("Too late"), mockReq, res, mockNext);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
