import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { socket } = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload?: unknown) => void>>();
  return {
    socket: {
      connected: true,
      emit: vi.fn(),
      on: (event: string, handler: (payload?: unknown) => void) => void handlers.set(event, (handlers.get(event) ?? new Set()).add(handler)),
      off: (event: string, handler?: (payload?: unknown) => void) => void (handler ? handlers.get(event)?.delete(handler) : handlers.delete(event)),
      arrive: (event: string, payload?: unknown) => handlers.get(event)?.forEach((h) => h(payload)),
      count: (event: string) => handlers.get(event)?.size ?? 0,
    },
  };
});
vi.mock("../context/BenchSocketContext.js", () => ({ useBenchSocket: () => ({ socket, connected: true }) }));

import { useBenchPresence } from "./useBenchPresence.js";

const person = (userId: number) => ({ userId, userName: `chef ${userId}`, userPhotoPath: null });
const presence = (channelKey: string, ids: number[]) => act(() => socket.arrive("bench:presence:update", { channelKey, users: ids.map(person) }));

describe("useBenchPresence", () => {
  const open = (channelKey: string) => {
    const hook = renderHook(({ key }) => useBenchPresence(key), { initialProps: { key: channelKey } });
    return { ...hook, ids: () => hook.result.current.onlineUsers.map((u) => u.userId) };
  };

  it("shows the open channel's list, not another room's that arrives later (as after a reconnect)", () => {
    const kitchen = open("org_5");
    presence("org_5", [1, 2]);
    presence("everyone", [1, 2, 3]);
    presence("dm_9", [1]);
    expect(kitchen.ids()).toEqual([1, 2]);
  });

  it("does not carry one channel's list into another", () => {
    const bench = open("org_5");
    presence("org_5", [1, 2]);
    bench.rerender({ key: "everyone" });
    expect(bench.ids()).toEqual([]);
    presence("everyone", [1]);
    expect(bench.ids()).toEqual([1]);
  });

  it("removes only its own connect listener", () => {
    socket.on("connect", () => undefined); // another hook's rejoin
    const bench = open("everyone");
    bench.rerender({ key: "org_5" });
    bench.unmount();
    expect(socket.count("connect")).toBe(1);
  });
});
