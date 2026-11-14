import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useShifts, useRosterTemplates, useRosterCalendar, useRosterRoles, useMyShifts, useMyAvailability } from "./useRoster.js";

type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void; signal?: AbortSignal; promise: Promise<unknown> };

/** Each fetch call parks on a deferred the test settles by hand; honours AbortSignal like real fetch. */
function parkedFetch() {
  const calls: Deferred[] = [];
  global.fetch = vi.fn((_url: string, init?: RequestInit) => {
    const d = {} as Deferred;
    d.signal = init?.signal ?? undefined;
    d.promise = new Promise((resolve, reject) => {
      d.resolve = resolve;
      d.reject = reject;
      d.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    calls.push(d);
    return d.promise;
  }) as unknown as typeof fetch;
  return calls;
}

const ok = (body: unknown) => ({ ok: true, json: async () => body });

// Each entry: how to render the hook and which field holds its list.
type Listing = { refresh: () => Promise<void>; isLoading: boolean; error: string | null } & Record<string, unknown>;
const hooks: Array<{ name: string; use: () => Listing; field: string }> = [
  { name: "useShifts", use: () => useShifts("loc1"), field: "shifts" },
  { name: "useRosterTemplates", use: () => useRosterTemplates("loc1"), field: "templates" },
  { name: "useRosterCalendar", use: () => useRosterCalendar("loc1", "2026-08-25", "2026-09-01"), field: "calendarShifts" },
  { name: "useRosterRoles", use: () => useRosterRoles(), field: "roles" },
  { name: "useMyShifts", use: () => useMyShifts(), field: "shifts" },
  { name: "useMyAvailability", use: () => useMyAvailability(), field: "availability" },
];

describe.each(hooks)("$name concurrent refresh", ({ use, field }) => {
  afterEach(() => vi.restoreAllMocks());

  it("a later refresh() aborts the earlier in-flight request", async () => {
    const calls = parkedFetch();
    const { result } = renderHook(use);
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      void result.current.refresh();
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].signal?.aborted).toBe(true);
    expect(calls[1].signal?.aborted).toBe(false);
  });

  it("an aborted request does not set error state", async () => {
    const calls = parkedFetch();
    const { result } = renderHook(use);
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      void result.current.refresh();
    });
    await act(async () => {
      calls[1].resolve(ok([{ id: "new" }]));
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current[field]).toEqual([{ id: "new" }]);
  });

  it("a stale response resolving after a newer one never overwrites it", async () => {
    const calls = parkedFetch();
    const { result } = renderHook(use);
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() => {
      void result.current.refresh();
    });
    await act(async () => {
      calls[1].resolve(ok([{ id: "new" }]));
    });
    await waitFor(() => expect(result.current[field]).toEqual([{ id: "new" }]));

    // The first request's body arrives late (a fetch that ignored the abort).
    await act(async () => {
      calls[0].resolve(ok([{ id: "old" }]));
    });

    expect(result.current[field]).toEqual([{ id: "new" }]);
  });
});
