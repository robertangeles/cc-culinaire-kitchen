import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Socket } from "socket.io";
import { onBenchEvent } from "./benchSocketGuard.js";

function fakeSocket() {
  const incoming = new EventEmitter();
  const sent: unknown[][] = [];
  const socket = {
    id: "s1",
    data: { user: { sub: 1 } },
    on: incoming.on.bind(incoming),
    emit: (...args: unknown[]) => sent.push(args),
  } as unknown as Socket;
  // EventEmitter drops what a listener returns, so call the listener to await it.
  const receive = (event: string, payload?: unknown) => incoming.listeners(event)[0](payload) as Promise<void>;
  return { socket, sent, receive };
}

describe("onBenchEvent", () => {
  it("hands the handler a well-formed payload, with a digit string as a number", async () => {
    const { socket, sent, receive } = fakeSocket();
    const handler = vi.fn();
    onBenchEvent(socket, "bench:dm:send", handler);
    await receive("bench:dm:send", { recipientId: "7", body: "hi", extra: 1 });
    expect(handler.mock.calls).toEqual([[{ recipientId: 7, body: "hi" }]]);
    expect(sent).toEqual([]);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a wrong type", { recipientId: {}, body: "hi" }],
    ["an id no row can have", { recipientId: 2_147_483_648, body: "hi" }],
    ["zero", { recipientId: 0, body: "hi" }],
  ])("drops %s and answers with a code", async (_name, payload) => {
    const { socket, sent, receive } = fakeSocket();
    const handler = vi.fn();
    onBenchEvent(socket, "bench:dm:send", handler);
    await receive("bench:dm:send", payload);
    expect(handler).not.toHaveBeenCalled();
    expect(sent).toEqual([["bench:error", { error: "Invalid request", code: "VALIDATION" }]]);
  });

  it.each(["org_2147483648", "dm_99999999999", "Everyone", "org 1", ""])("drops the channel name %j", async (channelKey) => {
    const { socket, receive } = fakeSocket();
    const handler = vi.fn();
    onBenchEvent(socket, "bench:join", handler);
    await receive("bench:join", { channelKey });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each([
    ["throws", () => { throw new Error("handler"); }],
    ["rejects", () => Promise.reject(new Error("handler"))],
  ])("keeps the error of a handler that %s", async (_name, handler) => {
    const { socket, receive } = fakeSocket();
    onBenchEvent(socket, "bench:presence:heartbeat", handler);
    await expect(receive("bench:presence:heartbeat")).resolves.toBeUndefined();
  });
});
