import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useShifts, usePublish, useMyShifts, useMyAvailability } from "./useRoster.js";

const res = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as unknown as Response;
const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<unknown>) => {
  const fn = vi.fn(impl);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};

describe("useShifts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads shifts, and surfaces a server error without throwing", async () => {
    mockFetch(async () => res(true, [{ shiftId: "s1" }]));
    const ok = renderHook(() => useShifts("loc1"));
    await waitFor(() => expect(ok.result.current.isLoading).toBe(false));
    expect(ok.result.current.shifts).toEqual([{ shiftId: "s1" }]);

    mockFetch(async () => res(false, { error: "Location not found" }));
    const bad = renderHook(() => useShifts("loc1"));
    await waitFor(() => expect(bad.result.current.error).toBe("Location not found"));
  });

  it("skips the fetch when no venue is selected", async () => {
    const fetchMock = mockFetch(async () => res(true, []));
    const { result } = renderHook(() => useShifts(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a background refresh after the first load does not flip isLoading (keeps PublishPanel mounted)", async () => {
    mockFetch(async () => res(true, []));
    const { result } = renderHook(() => useShifts("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const p = result.current.refresh();
      expect(result.current.isLoading).toBe(false);
      await p;
    });
  });

  it("cancel() throws the server message and does not refresh on failure", async () => {
    const fetchMock = mockFetch(async (url, init) =>
      init?.method === "POST" && String(url).includes("/cancel") ? res(false, { error: "Already published" }) : res(true, []),
    );
    const { result } = renderHook(() => useShifts("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.cancel("s1")).rejects.toThrow("Already published");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("assign() carries a blocked-document payload on the thrown error", async () => {
    const blocked = { documentType: "RSA", reason: "expired", expiryDate: null };
    mockFetch(async (url, init) =>
      init?.method === "POST" && String(url).includes("/assignments") ? res(false, { error: "Blocked", blocked }) : res(true, []),
    );
    const { result } = renderHook(() => useShifts("loc1"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.assign("s1", 5)).rejects.toMatchObject({ blocked });
    });
  });
});

describe("usePublish", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts the range and returns the publish result", async () => {
    const payload = { publishedShiftIds: ["s1"], heldShifts: [], awardWarnings: [], awardCoverage: {} };
    const fetchMock = mockFetch(async () => res(true, payload));
    const { result } = renderHook(() => usePublish());

    let out;
    await act(async () => {
      out = await result.current.publish("loc1", "2026-08-25", "2026-09-01");
    });

    expect(out).toEqual(payload);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      storeLocationId: "loc1",
      from: "2026-08-25",
      to: "2026-09-01",
    });
    expect(result.current.isPublishing).toBe(false);
  });

  it("throws the server message and still clears isPublishing on failure", async () => {
    mockFetch(async () => res(false, { error: "Nothing to publish" }));
    const { result } = renderHook(() => usePublish());

    await act(async () => {
      await expect(result.current.publish("loc1", "a", "b")).rejects.toThrow("Nothing to publish");
    });
    expect(result.current.isPublishing).toBe(false);
  });
});

describe("useMyShifts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads my shifts, and surfaces a server error", async () => {
    mockFetch(async () => res(true, [{ shiftId: "s1" }]));
    const ok = renderHook(() => useMyShifts());
    await waitFor(() => expect(ok.result.current.isLoading).toBe(false));
    expect(ok.result.current.shifts).toEqual([{ shiftId: "s1" }]);

    mockFetch(async () => res(false, { error: "Not signed in" }));
    const bad = renderHook(() => useMyShifts());
    await waitFor(() => expect(bad.result.current.error).toBe("Not signed in"));
  });

  it("respond() posts the answer then refreshes", async () => {
    const fetchMock = mockFetch(async (_url, init) => (init?.method === "POST" ? res(true, {}) : res(true, [])));
    const { result } = renderHook(() => useMyShifts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.respond("a1", "Confirmed"));

    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ response: "Confirmed" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respondToConsentRequest() hits the consent route and throws on failure", async () => {
    mockFetch(async (url, init) =>
      init?.method === "POST" && String(url).includes("/consent/respond") ? res(false, { error: "Too late" }) : res(true, []),
    );
    const { result } = renderHook(() => useMyShifts());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.respondToConsentRequest("a1", "Accepted")).rejects.toThrow("Too late");
    });
  });
});

describe("useMyAvailability", () => {
  afterEach(() => vi.restoreAllMocks());

  const slot = { dayOfWeek: 1, availableFrom: "09:00", availableUntil: "17:00", effectiveFrom: "2026-09-01" };

  it("loads availability, and surfaces a server error", async () => {
    mockFetch(async () => res(true, [{ staffAvailabilityId: "v1" }]));
    const ok = renderHook(() => useMyAvailability());
    await waitFor(() => expect(ok.result.current.isLoading).toBe(false));
    expect(ok.result.current.availability).toEqual([{ staffAvailabilityId: "v1" }]);

    mockFetch(async () => res(false, { error: "Not signed in" }));
    const bad = renderHook(() => useMyAvailability());
    await waitFor(() => expect(bad.result.current.error).toBe("Not signed in"));
  });

  it("create() posts then refreshes; a failure throws and does not refresh", async () => {
    let failPost = false;
    const fetchMock = mockFetch(async (_url, init) =>
      init?.method === "POST" ? (failPost ? res(false, { error: "Overlap" }) : res(true, {})) : res(true, []),
    );
    const { result } = renderHook(() => useMyAvailability());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.create(slot));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    failPost = true;
    await act(async () => {
      await expect(result.current.create(slot)).rejects.toThrow("Overlap");
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("remove() DELETEs then refreshes", async () => {
    const fetchMock = mockFetch(async (_url, init) => (init?.method === "DELETE" ? res(true, {}) : res(true, [])));
    const { result } = renderHook(() => useMyAvailability());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.remove("v1"));

    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
