import { describe, it, expect } from "vitest";
import * as inv from "./useInventory.js";

describe("useInventory barrel", () => {
  const expectedHooks = [
    "useIngredients",
    "useIngredientSuppliers",
    "useIngredientStock",
    "useIngredientTransactions",
    "useSuppliers",
    "usePurchaseOrders",
    "useTransfers",
    "useForecasts",
    "useLocationIngredients",
    "useOrgDashboard",
    "useStockTake",
    "usePendingReviews",
    "useStockTakeHistory",
    "useDashboard",
    "useConsumptionLog",
    "useStorageAreas",
    "useStockMovements",
  ];

  it.each(expectedHooks)("exports %s as a function", (name) => {
    expect(typeof (inv as Record<string, unknown>)[name]).toBe("function");
  });
});
