import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRosterCalendar } from "./useRoster.js";

const asFetch = (impl: () => Promise<unknown>) => vi.fn(impl) as unknown as typeof fetch;

const sampleShift = {
  shiftId: "s1",
  rosterRoleId: "r1",
  roleName: "Bartender",
  startDatetime: "2026-08-31T09:00:00Z",
  endDatetime: "2026-08-31T13:00:00Z",
  status: "Draft",
  isPublicHoliday: false,
  assignments: [],
};

describe("useRosterCalendar", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads calendar shifts on mount", async () => {
    global.fetch = asFetch(async () => ({ ok: true, json: async () => [sampleShift] }));

    const { result } = renderHook(() => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.calendarShifts).toEqual([sampleShift]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a server error message instead of throwing", async () => {
    global.fetch = asFetch(async () => ({ ok: false, json: async () => ({ error: "Location not found" }) }));

    const { result } = renderHook(() => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"));

    await waitFor(() => expect(result.current.error).toBe("Location not found"));
    expect(result.current.calendarShifts).toEqual([]);
  });

  it("skips the fetch entirely when no venue is selected", async () => {
    const fetchMock = asFetch(async () => ({ ok: true, json: async () => [] }));
    global.fetch = fetchMock;

    const { result } = renderHook(() => useRosterCalendar(null, "2026-08-25", "2026-09-01"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("create() posts a new shift and refreshes the calendar", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ shiftId: "new" }) };
      return { ok: true, json: async () => [sampleShift] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() =>
      result.current.create({
        storeLocationId: "loc1",
        rosterRoleId: "r1",
        startDatetime: "2026-08-31T09:00:00Z",
        endDatetime: "2026-08-31T13:00:00Z",
      }),
    );

    // Initial GET, the POST, then a refetch GET.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
  });

  it("create() throws the server's error message and does not refresh on failure", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: false, json: async () => ({ error: "Overlapping shift" }) };
      return { ok: true, json: async () => [] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(
        result.current.create({ storeLocationId: "loc1", rosterRoleId: "r1", startDatetime: "x", endDatetime: "y" }),
      ).rejects.toMatchObject({ message: "Overlapping shift" });
    });

    // Just the initial GET and the failed POST — no refetch after a failure.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("updateTime() PUTs the reschedule and refreshes", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => [sampleShift] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.updateTime("s1", { startDatetime: "2026-08-31T10:00:00Z" }));

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("assign() posts the assignment and refreshes", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && String(url).includes("/assignments")) return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => [sampleShift] };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { result } = renderHook(() => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.assign("s1", 42));

    expect(fetchMock.mock.calls.some(([url, init]) => init?.method === "POST" && String(url).includes("/assignments"))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
