import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/prepService.js", () => {
  class PrepError extends Error {
    constructor(message: string, public readonly statusCode: number) {
      super(message);
      this.name = "PrepError";
    }
  }
  return {
    PrepError,
    saveMenuSelections: vi.fn(),
    generateTasksFromSelections: vi.fn(),
    createPrepSession: vi.fn(),
    getMenuForSelection: vi.fn(),
    suggestSelections: vi.fn(),
    getSelections: vi.fn(),
    getPreviousSelections: vi.fn(),
    generateTasksForSession: vi.fn(),
    getPrepSession: vi.fn(),
    updateTaskStatus: vi.fn(),
    getIngredientCrossUsage: vi.fn(),
    getHighImpactDishes: vi.fn(),
    getSessionHistory: vi.fn(),
    endSession: vi.fn(),
    getTodaySession: vi.fn(),
  };
});

import { handleSaveSelections, handleGenerateFromSelections } from "./prepController.js";
import { saveMenuSelections, generateTasksFromSelections, PrepError } from "../services/prepService.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: { sub: 42 },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

/** A minimal valid selection body — passes saveSelectionsSchema.min(1). */
const validSelectionBody = {
  selections: [{ dishName: "Pasta Bolognese", expectedPortions: 10 }],
};

describe("handleSaveSelections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when prep session not found or not yours", async () => {
    vi.mocked(saveMenuSelections).mockRejectedValue(
      new PrepError("Prep session not found or not yours", 404),
    );

    const req = mockReq({ params: { id: "session-99" }, body: validSelectionBody });
    const res = mockRes();

    await handleSaveSelections(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Prep session not found or not yours" });
  });

  it("returns 409 when session is already ended", async () => {
    vi.mocked(saveMenuSelections).mockRejectedValue(
      new PrepError("Cannot modify an ended prep session", 409),
    );

    const req = mockReq({ params: { id: "session-ended" }, body: validSelectionBody });
    const res = mockRes();

    await handleSaveSelections(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Cannot modify an ended prep session" });
  });

  it("re-throws non-PrepError", async () => {
    vi.mocked(saveMenuSelections).mockRejectedValue(new Error("db exploded"));

    const req = mockReq({ params: { id: "session-1" }, body: validSelectionBody });
    const res = mockRes();

    await expect(handleSaveSelections(req, res)).rejects.toThrow("db exploded");
  });
});

describe("handleGenerateFromSelections", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when prep session not found or not yours", async () => {
    vi.mocked(generateTasksFromSelections).mockRejectedValue(
      new PrepError("Prep session not found or not yours", 404),
    );

    const req = mockReq({ params: { id: "session-missing" } });
    const res = mockRes();

    await handleGenerateFromSelections(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Prep session not found or not yours" });
  });

  it("re-throws non-PrepError", async () => {
    vi.mocked(generateTasksFromSelections).mockRejectedValue(new Error("network error"));

    const req = mockReq({ params: { id: "session-1" } });
    const res = mockRes();

    await expect(handleGenerateFromSelections(req, res)).rejects.toThrow("network error");
  });
});
