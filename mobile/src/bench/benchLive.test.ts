import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBenchLive, type LiveSocket } from "./benchLive";

/** A socket the test connects, drops and refuses by hand. */
function fakeSocket() {
  const handlers = new Map<string, (arg: never) => void>();
  const sent: [string, unknown][] = [];
  const socket: LiveSocket = {
    connected: false,
    active: false,
    on: (event, fn) => void handlers.set(event, fn),
    connect: vi.fn(() => void (socket.active = true)),
    disconnect: vi.fn(() => {
      socket.active = false;
      const was = socket.connected;
      socket.connected = false;
      if (was) handlers.get("disconnect")?.("io client disconnect" as never);
    }),
    volatile: { emit: (event, payload) => void sent.push([event, payload]) },
  };
  return {
    socket,
    sent,
    fire: (event: string, arg?: unknown) => handlers.get(event)?.(arg as never),
    up() {
      socket.connected = true;
      handlers.get("connect")?.(undefined as never);
    },
    drop() {
      socket.connected = false;
      handlers.get("disconnect")?.("transport close" as never);
    },
    refuse(message: string) {
      socket.active = false;
      handlers.get("connect_error")?.(new Error(message) as never);
    },
  };
}

function setup() {
  const fake = fakeSocket();
  const renew = vi.fn(async () => {});
  const live = createBenchLive({ socket: fake.socket, renew });
  const connects = vi.fn();
  live.onConnect(connects);
  return { ...fake, live, renew, connects };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe("the live connection", () => {
  it("connects only while started, and says so", () => {
    const t = setup();
    expect(t.socket.connect).not.toHaveBeenCalled();
    t.live.start();
    expect(t.live.getStatus()).toBe("connecting");
    t.up();
    expect(t.live.getStatus()).toBe("online");
    expect(t.connects).toHaveBeenCalledTimes(1);
    t.live.stop();
    expect(t.socket.disconnect).toHaveBeenCalled();
    expect(t.live.getStatus()).toBe("offline");
  });

  it("starting twice connects once", () => {
    const t = setup();
    t.live.start();
    t.live.start();
    expect(t.socket.connect).toHaveBeenCalledTimes(1);
  });

  it("tells the store each time it comes back, so missed messages are read again", () => {
    const t = setup();
    t.live.start();
    t.up();
    t.drop();
    expect(t.live.getStatus()).toBe("connecting");
    t.up();
    expect(t.connects).toHaveBeenCalledTimes(2);
  });

  it("sends nothing while it is not connected, now or later", () => {
    const t = setup();
    t.live.start();
    expect(t.live.send("bench:message", { body: "x" })).toBe(false);
    t.up();
    expect(t.sent).toEqual([]);
    expect(t.live.send("bench:message", { body: "y" })).toBe(true);
    expect(t.sent).toEqual([["bench:message", { body: "y" }]]);
  });

  it("a refused token is renewed through the normal client, then it connects again, with a longer wait each time", async () => {
    const t = setup();
    t.live.start();
    t.refuse("AUTH_INVALID");
    expect(t.renew).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.socket.connect).toHaveBeenCalledTimes(2);
    t.refuse("AUTH_INVALID");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.socket.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(t.socket.connect).toHaveBeenCalledTimes(3);
  });

  it("a renewal that fails (no signal, signed out) is tried again later, and not at all once stopped", async () => {
    const t = setup();
    t.renew.mockRejectedValue(new Error("no signal"));
    t.live.start();
    t.refuse("AUTH_REQUIRED");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.socket.connect).toHaveBeenCalledTimes(2);
    t.refuse("AUTH_REQUIRED");
    t.live.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.socket.connect).toHaveBeenCalledTimes(2);
  });

  it("leaves a plain network failure to the library, which tries again by itself", async () => {
    const t = setup();
    t.live.start();
    t.socket.active = true;
    t.fire("connect_error", new Error("websocket error"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.renew).not.toHaveBeenCalled();
    expect(t.socket.connect).toHaveBeenCalledTimes(1);
  });

  it("a server that closes the connection itself is connected to again", async () => {
    const t = setup();
    t.live.start();
    t.up();
    t.socket.connected = false;
    t.socket.active = false;
    t.fire("disconnect", "io server disconnect");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.socket.connect).toHaveBeenCalledTimes(2);
  });
});
