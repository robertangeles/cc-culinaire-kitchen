import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";

/** The web Bench's connection: socket.io never reconnects by itself after the server ends a connection, so the provider does, once, after a pause. */

const { sockets } = vi.hoisted(() => ({ sockets: [] as any[] }));
vi.mock("socket.io-client", () => ({
  io: () => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const socket = {
      on: (event: string, handler: (...args: unknown[]) => void) => void (handlers[event] = handler),
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: (event: string, ...args: unknown[]) => handlers[event]?.(...args),
    };
    sockets.push(socket);
    return socket;
  },
}));
// One auth value for every render: a fresh user object each time re-runs the provider's connect effect without end.
const { auth } = vi.hoisted(() => ({ auth: { user: { userId: 1 }, isGuest: false } }));
vi.mock("./AuthContext.js", () => ({ useAuth: () => auth }));

import { BenchSocketProvider } from "./BenchSocketContext.js";

describe("BenchSocketProvider", () => {
  beforeEach(() => {
    sockets.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("connects again, once, a few seconds after the server ended the connection", () => {
    render(<BenchSocketProvider>{null}</BenchSocketProvider>);
    const [socket] = sockets;
    act(() => socket.emit("disconnect", "io server disconnect"));
    act(() => socket.emit("disconnect", "io server disconnect"));
    act(() => void vi.advanceTimersByTime(2_999));
    expect(socket.connect).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it("leaves every other drop to socket.io's own reconnection", () => {
    render(<BenchSocketProvider>{null}</BenchSocketProvider>);
    const [socket] = sockets;
    act(() => socket.emit("disconnect", "transport close"));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("does not connect again once the provider is gone", () => {
    const { unmount } = render(<BenchSocketProvider>{null}</BenchSocketProvider>);
    const [socket] = sockets;
    act(() => socket.emit("disconnect", "io server disconnect"));
    unmount();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(socket.connect).not.toHaveBeenCalled();
  });
});
