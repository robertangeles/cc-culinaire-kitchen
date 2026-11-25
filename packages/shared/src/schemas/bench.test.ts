import { describe, expect, it } from "vitest";
import { BenchChannelListSchema, BenchMessagePageSchema, BenchMessageSchema, DmThreadListSchema, PinListSchema, PresenceSchema, SearchListSchema } from "./bench";

const message = { messageId: "m1", channelId: 4, userId: 7, userName: "Ana", userPhotoPath: null, messageBody: "Fish is in", messageType: "text", editedInd: false, createdDttm: "2026-11-26T01:00:00Z", reactions: [{ emoji: "fire", count: 2, userIds: [7, 8] }] };

describe("the Bench schemas", () => {
  it("reads a channel message and a direct message into one shape", () => {
    expect(BenchMessageSchema.parse({ ...message, recipeId: null, deletedInd: false })).toMatchObject({ messageId: "m1", channelId: 4, dmThreadId: null, reactions: [{ emoji: "fire", userIds: [7, 8] }] });
    // A direct message carries its thread and no channel, type or reactions.
    expect(BenchMessageSchema.parse({ messageId: "d1", dmThreadId: 3, userId: 8, userName: "Bo", userPhotoPath: "/uploads/b.png", messageBody: "hi", editedInd: true, deletedInd: false, createdDttm: "2026-11-26T01:00:00Z" })).toMatchObject({ channelId: null, dmThreadId: 3, messageType: "text", reactions: [], editedInd: true });
  });

  it("leaves out a message it cannot read, never the page", () => {
    expect(BenchMessagePageSchema.parse({ messages: [{ body: "junk" }, message], channelId: 4 }).map((m) => m.messageId)).toEqual(["m1"]);
  });

  // A message that names neither a channel nor a thread has no room: it must never be shown in whichever one is open.
  it("refuses a message with no room", () => {
    expect(BenchMessageSchema.safeParse({ ...message, channelId: null }).success).toBe(false);
  });

  it("keeps only the channel kinds it knows", () => {
    expect(BenchChannelListSchema.parse([{ channelId: 1, channelKey: "everyone", channelName: "Everyone", channelType: "global" }, { channelId: 2, channelKey: "org_5", channelName: "Main", channelType: "organisation", channelBanner: "Hi" }, { channelId: 3, channelKey: "x", channelName: "X", channelType: "hologram" }])).toEqual([
      { channelId: 1, channelKey: "everyone", channelName: "Everyone", channelType: "global", channelBanner: null },
      { channelId: 2, channelKey: "org_5", channelName: "Main", channelType: "organisation", channelBanner: "Hi" },
    ]);
  });

  it("reads threads, pins, search results and presence", () => {
    expect(DmThreadListSchema.parse([{ dmThreadId: 3, otherUserId: 8, otherUserName: "Bo", otherUserPhotoPath: null, lastMessage: "hi", lastMessageAt: "2026-11-26T01:00:00Z" }, {}])).toHaveLength(1);
    expect(PinListSchema.parse([{ pinId: 1, messageId: "m1", pinnedBy: 7, messageBody: "Fish is in", userId: 7, userName: null }, { pinId: 2, messageId: "m2", messageBody: null }])).toEqual([{ messageId: "m1", messageBody: "Fish is in", userName: "Chef" }]);
    expect(SearchListSchema.parse([{ messageId: "m1", messageBody: "Fish is in", userName: "Ana", createdDttm: "2026-11-26T01:00:00Z" }])).toHaveLength(1);
    expect(PresenceSchema.parse({ channelKey: "org_5", users: [{ userId: 8, userName: "Bo", userPhotoPath: null }, "junk"] })).toEqual({ channelKey: "org_5", users: [{ userId: 8, userName: "Bo", userPhotoPath: null }] });
  });
});
