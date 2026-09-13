import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRosterTemplates } from "./useRoster.js";

const asFetch = (impl: () => Promise<unknown>) => vi.fn(impl) as unknown as typeof fetch;

const sampleRow = {
  rosterShiftTemplateId: "t1",
  organisationId: 1,
  storeLocationId: "loc1",
  rosterRoleId: "r1",
  dayOfWeek: 1,
  startTime: "09:00",
  endTime: "17:00",
  createdDttm: "2026-09-07T00:00:00Z",
  updatedDttm: "2026-09-07T00:00:00Z",
};

describe("useRosterTemplates", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads templates on mount", async () => {
    global.fetch = asFetch(async () => ({ ok: true, json: async () => [sampleRow] }));

    const { result } = renderHook(() => useRosterTemplates("loc1"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.templates).toEqual([sampleRow]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a server error message instead of throwing", async () => {
    global.fetch = asFetch(async () => ({ ok: false, json: async () => ({ error: "Location not found" }) }));

    const { result } = renderHook(() => useRosterTemplates("loc1"));

    await waitFor(() => expect(result.current.error).toBe("Location not found"));
    expect(result.current.templates).toEqual([]);
  });

  it("skips the fetch entirely when no venue is selected", async () => {
    const fetchMock = asFetch(async () => ({ ok: true, json: async () => [] }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useRosterTemplates(null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fetches (and shows the spinner again) when the venue changes — the stale-closure-safe pattern", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => [sampleRow] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result, rerender } = renderHook(({ loc }) => useRosterTemplates(loc), {
      initialProps: { loc: "loc1" as string | null },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender({ loc: "loc2" });
    // A genuine venue switch resets hasLoadedOnce, so isLoading flips true again mid-fetch.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock.mock.calls[1][0]).toContain("storeLocationId=loc2");
  });

  it("create() posts a new template row and refreshes", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => sampleRow };
      return { ok: true, json: async () => [sampleRow] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterTemplates("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() =>
      result.current.create({
        storeLocationId: "loc1",
        rosterRoleId: "r1",
        dayOfWeek: 1,
        startTime: "09:00",
        endTime: "17:00",
      }),
    );

    // Initial GET, the POST, then a refetch GET.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("create() throws the server's error message and does not refresh on failure", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, json: async () => ({ error: "Overlapping template row" }) };
      return { ok: true, json: async () => [] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterTemplates("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(() =>
        result.current.create({
          storeLocationId: "loc1",
          rosterRoleId: "r1",
          dayOfWeek: 1,
          startTime: "09:00",
          endTime: "17:00",
        }),
      ),
    ).rejects.toThrow("Overlapping template row");

    expect(fetchMock).toHaveBeenCalledTimes(2); // initial GET + the failed POST, no refetch
  });

  it("update() PATCHes the given row and refreshes", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return { ok: true, json: async () => sampleRow };
      return { ok: true, json: async () => [sampleRow] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterTemplates("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() =>
      result.current.update("t1", {
        storeLocationId: "loc1",
        rosterRoleId: "r1",
        dayOfWeek: 1,
        startTime: "10:00",
        endTime: "18:00",
      }),
    );

    expect(fetchMock.mock.calls[1]).toMatchObject(["/api/roster/templates/t1", { method: "PATCH" }]);
  });

  it("remove() DELETEs the given row and refreshes", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => [] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterTemplates("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.remove("t1"));

    expect(fetchMock.mock.calls[1]).toMatchObject(["/api/roster/templates/t1", { method: "DELETE" }]);
  });

  it("generateWeek() posts to the generate route with storeLocationId + weekStart and returns the result", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ created: 5, skipped: 1, failed: 0 }) };
      return { ok: true, json: async () => [] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterTemplates("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await result.current.generateWeek("2027-03-01");

    expect(outcome).toEqual({ created: 5, skipped: 1, failed: 0 });
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/roster/templates/generate");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      storeLocationId: "loc1",
      weekStart: "2027-03-01",
    });
    // generateWeek does not itself trigger a templates refetch — it doesn't change templates.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("undoGeneration() posts to the undo-generation route and returns the cancelled count", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ cancelled: 3 }) };
      return { ok: true, json: async () => [] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterTemplates("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const outcome = await result.current.undoGeneration("2027-03-01");

    expect(outcome).toEqual({ cancelled: 3 });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/roster/templates/undo-generation");
  });

  it("generateWeek() throws without calling fetch when no venue is selected", async () => {
    const fetchMock = asFetch(async () => ({ ok: true, json: async () => [] }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useRosterTemplates(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.generateWeek("2027-03-01")).rejects.toThrow("No venue selected");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
