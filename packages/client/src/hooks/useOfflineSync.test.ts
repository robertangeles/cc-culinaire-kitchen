import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOfflineSync } from "./useOfflineSync.js";

/**
 * The bug this guards: a server that ANSWERS with an error (e.g. 400
 * "category NOT_STARTED") used to be reported as "offline", so a chef saw
 * "Saved offline" when the count was actually rejected. The online paths here
 * never touch IndexedDB, so no fake-indexeddb dep is needed.
 */
const asFetch = (impl: () => Promise<unknown>) => vi.fn(impl) as unknown as typeof fetch;

describe("useOfflineSync.saveWithOfflineFallback", () => {
  afterEach(() => vi.restoreAllMocks());

  const data = { ingredientId: "i1", rawQty: 3, countedUnit: "each" };

  it("reports a server rejection as 'error' with the reason — never 'offline'", async () => {
    global.fetch = asFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "Cannot count: category is NOT_STARTED" }),
    }));

    const { result } = renderHook(() => useOfflineSync());
    const res = await result.current.saveWithOfflineFallback("s1", "spirits", data);

    expect(res).toEqual({
      saved: "error",
      status: 400,
      message: "Cannot count: category is NOT_STARTED",
    });
  });

  it("reports a successful save as 'server'", async () => {
    global.fetch = asFetch(async () => ({ ok: true, status: 200, json: async () => ({ lineId: "l1" }) }));

    const { result } = renderHook(() => useOfflineSync());
    const res = await result.current.saveWithOfflineFallback("s1", "spirits", data);

    expect(res.saved).toBe("server");
  });

  it("URL-encodes the category name so a slash/space name can't break the route", async () => {
    const fetchMock = asFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useOfflineSync());
    await result.current.saveWithOfflineFallback("s1", "FOH / Counter", data);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/categories/FOH%20%2F%20Counter/lines"),
      expect.anything(),
    );
  });
});
