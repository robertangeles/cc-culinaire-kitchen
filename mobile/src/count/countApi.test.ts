import { describe, it, expect, vi } from "vitest";
import { createCountApi } from "./countApi";
import { ApiError, type ApiClient } from "../api/client";

function setup(replies: Array<unknown | Error>) {
  const request = vi.fn(async () => {
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { api: createCountApi({ request } as unknown as ApiClient), request };
}

const category = { categoryId: "c1", categoryName: "Bar", categoryStatus: "IN_PROGRESS", claimedByUserId: 1, claimedByUserName: "Chef", claimRevision: 2 };

describe("reading", () => {
  it("returns the open stock take with its areas, or null when none is open", async () => {
    const { api, request } = setup([{ sessionId: "S1", sessionStatus: "OPEN", countMode: "AREA", locationName: "Main", categories: [category], extra: 1 }, null]);
    expect(await api.activeSession()).toMatchObject({ sessionId: "S1", countMode: "AREA", categories: [{ categoryName: "Bar", claimRevision: 2 }] });
    expect(request).toHaveBeenCalledWith("GET", "/api/inventory/stock-takes/active");
    expect(await api.activeSession()).toBeNull();
  });

  it("downloads the area sheets", async () => {
    const areas = [{ categoryId: "c1", categoryName: "Bar", items: [{ ingredientId: "i1", ingredientName: "Shiraz", countUnit: "kg", alsoIn: [] }] }];
    const { api, request } = setup([{ sessionId: "S1", areas }]);
    expect(await api.countSheets("S1")).toEqual(areas);
    expect(request).toHaveBeenCalledWith("GET", "/api/inventory/stock-takes/S1/count-sheets");
  });

  it("reads an area's saved lines as numbers", async () => {
    const { api, request } = setup([[{ ingredientId: "i1", rawQty: "2.500", countedUnit: "kg", other: "x" }]]);
    expect(await api.areaLines("S1", "Stock Room")).toEqual([{ ingredientId: "i1", rawQty: 2.5, countedUnit: "kg" }]);
    expect(request).toHaveBeenCalledWith("GET", "/api/inventory/stock-takes/S1/categories/Stock%20Room/lines");
  });
});

describe("claiming an area", () => {
  it("returns the claim with its revision", async () => {
    const { api, request } = setup([category]);
    expect(await api.claimArea("S1", "Bar")).toEqual({ status: "claimed", categoryId: "c1", claimRevision: 2 });
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/stock-takes/S1/categories/Bar/claim");
  });

  it("says the area is held when another chef already has it", async () => {
    const { api } = setup([new ApiError("bad_request", "Cannot claim category: current status is IN_PROGRESS", 400)]);
    expect(await api.claimArea("S1", "Bar")).toEqual({ status: "held" });
  });

  it("says the area is already submitted when its status is past counting", async () => {
    const { api } = setup([new ApiError("bad_request", "Cannot claim category: current status is SUBMITTED", 400)]);
    expect(await api.claimArea("S1", "Bar")).toEqual({ status: "submitted" });
  });

  it("lets other failures (offline, signed out) through to the screen", async () => {
    const { api } = setup([new ApiError("network")]);
    await expect(api.claimArea("S1", "Bar")).rejects.toMatchObject({ code: "network" });
  });
});

describe("submitting an area", () => {
  it("is ok when the server accepts it, sending the claim revision", async () => {
    const { api, request } = setup([{}]);
    expect(await api.submitArea("S1", "Bar", 2)).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("POST", "/api/inventory/stock-takes/S1/categories/Bar/submit", { body: { claimRevision: 2 } });
  });

  it("returns the shared items still missing from the server's 409", async () => {
    const missing = [{ ingredientId: "i1", ingredientName: "Shiraz", areaNames: ["Stock Room"] }];
    const { api } = setup([new ApiError("conflict", "Count these items", 409, { error: "Count these items", missing })]);
    expect(await api.submitArea("S1", "Bar", 2)).toEqual({ ok: false, missing, message: "Count these items" });
  });

  it("lets any other refusal through", async () => {
    const { api } = setup([new ApiError("forbidden", "Only the person who claimed this category can count or submit it", 403)]);
    await expect(api.submitArea("S1", "Bar", 2)).rejects.toMatchObject({ code: "forbidden" });
  });
});
