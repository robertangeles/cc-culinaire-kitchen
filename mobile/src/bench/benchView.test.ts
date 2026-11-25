import { describe, expect, it } from "vitest";
import type { BenchMessage } from "@culinaire/shared/schemas/bench";
import { canDelete, canEdit, canPin, dayLabel, emojiOf, insertMention, mentionQuery, peopleMatching, typingText } from "./benchView";

const me = (over: object = {}) => ({ userId: 7, userName: "Ana", userEmail: "a@x.test", mfaEnabled: false, roles: [] as string[], permissions: [], ...over });
const message = (over: Partial<BenchMessage> = {}): BenchMessage => ({ messageId: "m1", channelId: 4, dmThreadId: null, userId: 7, userName: "Ana", userPhotoPath: null, messageBody: "hi", messageType: "text", recipeTitle: null, editedInd: false, createdDttm: "2026-11-26T01:00:00Z", reactions: [], ...over });

describe("what the Bench says", () => {
  it("names today, yesterday and older days", () => {
    const now = new Date(2026, 10, 26, 9).getTime();
    expect(dayLabel(new Date(2026, 10, 26, 1).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 10, 25, 23).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 10, 2).toISOString(), now)).toMatch(/2/);
  });

  it("says who is writing, as the web does", () => {
    expect(typingText([])).toBe("");
    expect(typingText(["Bo"])).toBe("Bo is writing…");
    expect(typingText(["Bo", "Cy"])).toBe("Bo and Cy are writing…");
    expect(typingText(["Bo", "Cy", "Di"])).toBe("Bo and 2 others are writing…");
  });

  it("shows the web's eight reactions, and one it does not know as it is", () => {
    expect(emojiOf("fire")).toBe("🔥");
    expect(emojiOf("parsley")).toBe("parsley");
  });
});

describe("mentions", () => {
  it("offers people while an @ word is being typed at the end, and only then", () => {
    expect(mentionQuery("ask @b")).toBe("b");
    expect(mentionQuery("@")).toBe("");
    expect(mentionQuery("mail a@b.test now")).toBeNull();
    expect(mentionQuery("ask @bo ")).toBeNull();
  });

  it("finds people by any part of the name, at most six, and writes the name into the message", () => {
    const people = ["Bo Li", "Abo", "Cy"].map((userName, i) => ({ userId: i, userName, userPhotoPath: null }));
    expect(peopleMatching(people, "bo").map((p) => p.userName)).toEqual(["Bo Li", "Abo"]);
    expect(insertMention("ask @b", "Bo Li")).toBe("ask @Bo Li ");
  });
});

describe("who may do what (the server checks again)", () => {
  it("edits only their own words", () => {
    expect(canEdit(me(), message())).toBe(true);
    expect(canEdit(me(), message({ userId: 8 }))).toBe(false);
    expect(canEdit(me({ roles: ["Administrator"] }), message({ userId: 8 }))).toBe(false);
    expect(canEdit(me(), message({ messageType: "recipe_share" }))).toBe(false);
  });

  it("deletes their own, or anyone's as an Administrator", () => {
    expect(canDelete(me(), message())).toBe(true);
    expect(canDelete(me(), message({ userId: 8 }))).toBe(false);
    expect(canDelete(me({ roles: ["Administrator"] }), message({ userId: 8 }))).toBe(true);
  });

  it("pins in any channel, whoever can reach it, and not in a direct message", () => {
    expect(canPin({ kind: "channel", key: "org_5" })).toBe(true);
    expect(canPin({ kind: "channel", key: "everyone" })).toBe(true);
    expect(canPin({ kind: "dm", threadId: 3 })).toBe(false);
  });
});
