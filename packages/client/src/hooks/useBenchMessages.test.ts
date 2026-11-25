import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const { socket } = vi.hoisted(() => {
  const handlers = new Map<string, (payload: unknown) => void>();
  return {
    socket: {
      connected: true,
      emit: () => undefined,
      on: (event: string, handler: (payload: unknown) => void) => void handlers.set(event, handler),
      off: (event: string) => void handlers.delete(event),
      arrive: (event: string, payload: unknown) => handlers.get(event)!(payload),
    },
  };
});
vi.mock("../context/BenchSocketContext.js", () => ({ useBenchSocket: () => ({ socket, connected: true }) }));

import { useBenchMessages } from "./useBenchMessages.js";

const message = (messageId: string) => ({ messageId, messageBody: messageId, createdDttm: "2026-11-26T01:00:00.000Z", reactions: [] });

/** What each channel's list answers; a promise that is not settled is an answer still on its way. */
let lists: Record<string, Promise<unknown[]>>;

describe("useBenchMessages", () => {
  beforeEach(() => {
    lists = { everyone: Promise.resolve([message("e1")]), org_5: Promise.resolve([message("k1")]) };
    vi.stubGlobal("fetch", async (url: string) => {
      const messages = await lists[/channels\/(\w+)\//.exec(url)![1]];
      return { ok: true, json: async () => ({ messages }) };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const open = async (channelKey: string) => {
    const hook = renderHook(({ key }) => useBenchMessages(key), { initialProps: { key: channelKey } });
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    return { ...hook, ids: () => hook.result.current.messages.map((m) => m.messageId) };
  };
  const arrive = (payload: unknown) => act(() => socket.arrive("bench:message:new", payload));

  it("adds a new message to its own channel only, once", async () => {
    const kitchen = await open("org_5");
    arrive({ ...message("e2"), channelKey: "everyone" });
    arrive({ ...message("k2"), channelKey: "org_5" });
    arrive({ ...message("k2"), channelKey: "org_5" });
    expect(kitchen.ids()).toEqual(["k1", "k2"]);
  });

  it("follows the channel that is open after a switch", async () => {
    const bench = await open("org_5");
    bench.rerender({ key: "everyone" });
    await waitFor(() => expect(bench.ids()).toEqual(["e1"]));
    arrive({ ...message("k2"), channelKey: "org_5" });
    arrive({ ...message("e2"), channelKey: "everyone" });
    expect(bench.ids()).toEqual(["e1", "e2"]);
  });

  it("drops the list of a channel that is no longer open", async () => {
    let answer: (messages: unknown[]) => void = () => undefined;
    lists.everyone = new Promise((r) => (answer = r));
    const bench = renderHook(({ key }) => useBenchMessages(key), { initialProps: { key: "everyone" } });
    bench.rerender({ key: "org_5" });
    await waitFor(() => expect(bench.result.current.messages.map((m) => m.messageId)).toEqual(["k1"]));
    await act(async () => answer([message("e1")]));
    expect(bench.result.current.messages.map((m) => m.messageId)).toEqual(["k1"]);
  });
});
