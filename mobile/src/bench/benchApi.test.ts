import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { createBenchApi } from "./benchApi";

const message = { messageId: "m1", channelId: 4, userId: 7, userName: "Ana", userPhotoPath: "/uploads/a.png", messageBody: "Fish is in", createdDttm: "2026-11-26T01:00:00Z" };

function setup(reply: unknown = []) {
  const request = vi.fn(async (_m: string, _p: string, o: { schema?: { parse(d: unknown): unknown } } = {}) => (o.schema ? o.schema.parse(reply) : reply));
  return { request, api: createBenchApi({ baseUrl: "https://kitchen.test", request } as unknown as ApiClient) };
}

describe("bench api", () => {
  it("reads a room's messages, the latest page or the one before a time, with whole picture addresses", async () => {
    const { api, request } = setup({ messages: [message, { ...message, messageId: "m2", userPhotoPath: "https://res.cloudinary.com/x/b.png" }] });
    expect((await api.messages({ kind: "channel", key: "org_5" })).map((m) => m.userPhotoPath)).toEqual(["https://kitchen.test/uploads/a.png", "https://res.cloudinary.com/x/b.png"]);
    expect(api.whole("/uploads/generated/a-1.png")).toBe("https://kitchen.test/uploads/generated/a-1.png");
    expect(request.mock.calls[0].slice(0, 2)).toEqual(["GET", "/api/bench/channels/org_5/messages?limit=50"]);
    await api.messages({ kind: "dm", threadId: 3 }, "2026-11-26T01:00:00.000Z");
    expect(request.mock.calls[1][1]).toBe("/api/bench/dm/threads/3/messages?limit=50&before=2026-11-26T01%3A00%3A00.000Z");
  });

  // A picture's address is text its owner can edit: as the web's content policy has it, only the site's own uploads and Cloudinary are loaded.
  it.each(["https://evil.test/x.png", "http://res.cloudinary.com/x.png", "https://res.cloudinary.com.evil.test/x.png", "https://res.cloudinary.com@evil.test/x.png", "//evil.test/x.png", "/api/users/1", "/uploads/../api/x", "/uploads/%2e%2e/api/x", "/uploads/.%2E/api/x", "/uploads/%2e./api/x", "/uploads/.\n./api/x", "/uploads/a.png\n", "/uploads\\..\\api\\x", "/uploads/a.png?x=1", "/uploads/a.png#x", "file:///data/x", "data:image/png;base64,AA", "javascript:1"])("never loads a picture from %s", (path) => {
    expect(setup().api.whole(path)).toBeNull();
  });

  it("pins, unpins and searches inside one channel", async () => {
    const { api, request } = setup();
    await api.pins("org_5");
    await api.pin("org_5", "m1");
    await api.unpin("m1");
    await api.search("org_5", " fish & chips ");
    expect(request.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["GET", "/api/bench/channels/org_5/pins"],
      ["POST", "/api/bench/channels/org_5/pins"],
      ["DELETE", "/api/bench/pins/m1"],
      ["GET", "/api/bench/channels/org_5/search?q=fish%20%26%20chips&limit=50"],
    ]);
    expect(request.mock.calls[1][2]).toMatchObject({ body: { messageId: "m1" } });
  });

  it("opens a thread with a colleague as a thread that can be shown before its first message", async () => {
    const { api } = setup({ dmThreadId: 9, userAId: 1, userBId: 8, otherUserName: "Bo", otherUserPhotoPath: "/uploads/b.png" });
    expect(await api.openThread(8)).toEqual({ dmThreadId: 9, otherUserId: 8, otherUserName: "Bo", otherUserPhotoPath: "https://kitchen.test/uploads/b.png", lastMessage: null, lastMessageAt: "" });
  });

  it("blocks, unblocks and lists the people blocked, with whole picture addresses", async () => {
    const { api, request } = setup([{ userId: 8, userName: "Bo", userPhotoPath: "/uploads/b.png" }]);
    expect(await api.blocked()).toEqual([{ userId: 8, userName: "Bo", userPhotoPath: "https://kitchen.test/uploads/b.png" }]);
    await api.block(8);
    await api.unblock(8);
    expect(request.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["GET", "/api/bench/blocks"],
      ["POST", "/api/bench/blocks"],
      ["DELETE", "/api/bench/blocks/8"],
    ]);
    expect(request.mock.calls[1][2]).toMatchObject({ body: { userId: 8 } });
  });

  it("reports a message or a person, and a moderator reads and closes reports", async () => {
    const { api, request } = setup([]);
    await api.report({ messageId: "4f0c7c34-3a4a-4b8e-9d4c-1c2b3a4d5e6f", reason: "spam" });
    await api.report({ userId: 8, reason: "other", note: "x" });
    await api.reports();
    await api.act("r1", "hide");
    await api.act("r1", "dismiss");
    expect(request.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      ["POST", "/api/bench/reports"],
      ["POST", "/api/bench/reports"],
      ["GET", "/api/bench/reports?status=open"],
      ["POST", "/api/bench/reports/r1/hide"],
      ["POST", "/api/bench/reports/r1/dismiss"],
    ]);
    expect(request.mock.calls[1][2]).toMatchObject({ body: { userId: 8, reason: "other", note: "x" } });
  });
});
