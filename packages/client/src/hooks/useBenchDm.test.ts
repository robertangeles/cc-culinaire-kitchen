import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const socket = { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() };
vi.mock("../context/BenchSocketContext.js", () => ({ useBenchSocket: () => ({ socket, connected: true }) }));

import { useBenchDm } from "./useBenchDm.js";

const REFUSED = "You can message people in your kitchen, and people you already have a conversation with.";

/** What opening a thread answers. */
let opened: { status: number; body: unknown };

describe("useBenchDm starting a conversation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return { ok: opened.status < 400, status: opened.status, json: async () => opened.body };
      return { ok: true, status: 200, json: async () => (url.endsWith("/dm/threads") ? [] : { messages: [] }) };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const start = async (recipientId: number) => {
    const hook = renderHook(() => useBenchDm());
    await waitFor(() => expect(hook.result.current.loadingThreads).toBe(false));
    await act(() => hook.result.current.startDm(recipientId));
    return hook;
  };

  it("says why, in the server's words, when the person may not be written to, and opens nothing", async () => {
    opened = { status: 403, body: { error: REFUSED, code: "DM_NOT_ALLOWED" } };
    const hook = await start(7);
    expect(hook.result.current.startError).toBe(REFUSED);
    expect(hook.result.current.activeThreadId).toBeNull();
  });

  it("says something plain when the answer has no words", async () => {
    opened = { status: 500, body: {} };
    const hook = await start(7);
    expect(hook.result.current.startError).toBe("Couldn't open that conversation. Try again.");
  });

  it("opens the thread, and clears an earlier refusal", async () => {
    opened = { status: 403, body: { error: REFUSED, code: "DM_NOT_ALLOWED" } };
    const hook = await start(7);
    opened = { status: 200, body: { dmThreadId: 3, otherUserName: "Amir", otherUserPhotoPath: null } };
    await act(() => hook.result.current.startDm(8));
    expect(hook.result.current.startError).toBeNull();
    expect(hook.result.current.activeThreadId).toBe(3);
  });
});
