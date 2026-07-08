import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBrainMemories, type BrainMemory } from "./useBrainMemories.js";

const SEED: BrainMemory = {
  memoryId: "m1",
  title: "t",
  body: "original",
  sourceType: "chat",
  scope: "user",
  isPinned: false,
  status: "ready",
  createdDttm: "2026-07-01T00:00:00.000Z",
};

const fetchMock = vi.fn();

/** The last PATCH call to a given path suffix, if any. */
function patchCall(suffix: string) {
  return fetchMock.mock.calls.find(
    (c) => String(c[0]).includes(`/api/brain/memories/${suffix}`) && c[1]?.method === "PATCH",
  );
}

describe("useBrainMemories (T14b mutations)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    // Every request resolves ok; GETs read the seeded list, PATCHes ignore the body.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ memories: [SEED], total: 1 }) });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("always sends the scope param and defaults to Private", async () => {
    const { result } = renderHook(() => useBrainMemories());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.scopeFilter).toBe("user");
    const getCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/brain/memories?"));
    expect(String(getCall?.[0])).toContain("scope=user");
  });

  it("pin → PATCH /:id/pin and marks the row pinned", async () => {
    const { result } = renderHook(() => useBrainMemories());
    await waitFor(() => expect(result.current.memories).toHaveLength(1));
    await act(async () => {
      await result.current.pin("m1", true);
    });
    const call = patchCall("m1/pin");
    expect(call?.[1]?.method).toBe("PATCH");
    expect(JSON.parse(call![1].body)).toEqual({ pinned: true });
    expect(result.current.memories[0].isPinned).toBe(true);
  });

  it("correct → PATCH /:id with the new body and re-enters 'learning' (pending)", async () => {
    const { result } = renderHook(() => useBrainMemories());
    await waitFor(() => expect(result.current.memories).toHaveLength(1));
    await act(async () => {
      await result.current.correct("m1", "corrected body");
    });
    const call = patchCall("m1");
    expect(JSON.parse(call![1].body)).toEqual({ body: "corrected body" });
    expect(result.current.memories[0].body).toBe("corrected body");
    expect(result.current.memories[0].status).toBe("pending");
  });

  it("toggleScope → PATCH /:id/scope and drops the row from the current tab", async () => {
    const { result } = renderHook(() => useBrainMemories());
    await waitFor(() => expect(result.current.memories).toHaveLength(1));
    await act(async () => {
      await result.current.toggleScope("m1", "org"); // share from the Private tab
    });
    const call = patchCall("m1/scope");
    expect(JSON.parse(call![1].body)).toEqual({ scope: "org" });
    // On the Private tab, a now-shared memory leaves the view.
    expect(result.current.memories).toHaveLength(0);
  });
});
