import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

vi.mock("../services/locationContextService.js", () => ({
  getUserLocationContext: vi.fn(async () => ({
    locations: [{ organisationId: 7 }],
    organisationId: 7,
  })),
}));

vi.mock("../services/unitConversionService.js", () => ({
  invalidateConversionCache: vi.fn(async () => undefined),
}));

vi.mock("../services/ingredientService.js", () => {
  class IngredientError extends Error {
    constructor(message: string, public readonly statusCode: number) {
      super(message);
      this.name = "IngredientError";
    }
  }
  return {
    IngredientError,
    createSupplier: vi.fn(),
    setSupplierLocations: vi.fn(),
    updateSupplier: vi.fn(),
    listSuppliers: vi.fn(),
    deleteSupplier: vi.fn(),
    createIngredient: vi.fn(),
    listIngredients: vi.fn(),
    getIngredient: vi.fn(),
    updateIngredient: vi.fn(),
    listLocationIngredients: vi.fn(),
    updateLocationIngredient: vi.fn(),
    addUnitConversion: vi.fn(),
    listUnitConversions: vi.fn(),
    deleteUnitConversion: vi.fn(),
    getIngredientStockAcrossLocations: vi.fn(),
    getSupplierLocations: vi.fn(),
    assignSupplierToIngredient: vi.fn(),
    listIngredientSuppliers: vi.fn(),
    updateIngredientSupplier: vi.fn(),
    removeIngredientSupplier: vi.fn(),
    listSupplierIngredientIds: vi.fn(),
    bulkActivateItems: vi.fn(),
    bulkDeactivateItems: vi.fn(),
    copyActivationFromLocation: vi.fn(),
    getActivationStatus: vi.fn(),
    getIngredientTransactions: vi.fn(),
    getIngredientUsage: vi.fn(),
    softDeleteIngredient: vi.fn(),
    getSupplierInOrg: vi.fn(),
  };
});

import {
  handleCreateSupplier,
  handleUpdateSupplier,
} from "./ingredientController.js";
import {
  createSupplier,
  updateSupplier,
  IngredientError,
} from "../services/ingredientService.js";

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    headers: {},
    user: { sub: 1 },
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

describe("handleCreateSupplier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns IngredientError statusCode and message", async () => {
    vi.mocked(createSupplier).mockRejectedValue(
      new IngredientError("One or more location IDs do not belong to your organisation", 400),
    );

    const req = mockReq({ body: { supplierName: "ACME Foods" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleCreateSupplier(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "One or more location IDs do not belong to your organisation",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for non-IngredientError", async () => {
    const dbErr = Object.assign(new Error("deadlock"), { code: "40P01" });
    vi.mocked(createSupplier).mockRejectedValue(dbErr);

    const req = mockReq({ body: { supplierName: "ACME Foods" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleCreateSupplier(req, res, next);

    expect(next).toHaveBeenCalledWith(dbErr);
  });
});

describe("handleUpdateSupplier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns IngredientError statusCode and message", async () => {
    vi.mocked(updateSupplier).mockRejectedValue(
      new IngredientError("One or more location IDs do not belong to your organisation", 400),
    );

    const req = mockReq({ body: { supplierName: "ACME Updated" }, params: { id: "sup-1" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleUpdateSupplier(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "One or more location IDs do not belong to your organisation",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for non-IngredientError", async () => {
    const dbErr = Object.assign(new Error("timeout"), { code: "57P01" });
    vi.mocked(updateSupplier).mockRejectedValue(dbErr);

    const req = mockReq({ body: { supplierName: "ACME Updated" }, params: { id: "sup-1" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleUpdateSupplier(req, res, next);

    expect(next).toHaveBeenCalledWith(dbErr);
  });

  it("returns 409 for duplicate-key postgres error", async () => {
    const pgErr = Object.assign(new Error("duplicate key"), { code: "23505" });
    vi.mocked(updateSupplier).mockRejectedValue(pgErr);

    const req = mockReq({ body: { supplierName: "Dup Name" }, params: { id: "sup-2" } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await handleUpdateSupplier(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "A supplier with this name already exists" });
  });
});
