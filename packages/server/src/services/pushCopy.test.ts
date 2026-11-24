import { describe, it, expect } from "vitest";
import { NOTIFICATION_TYPES } from "@culinaire/shared/schemas/push";
import { pushCopy, PUSH_TYPE_LABELS } from "./pushCopy.js";

describe("pushCopy", () => {
  it("has a title and body for every notification type, and a label for the settings screen", () => {
    for (const type of NOTIFICATION_TYPES) {
      const { title, body } = pushCopy(type);
      expect(title.length, type).toBeGreaterThan(0);
      expect(body.length, type).toBeGreaterThan(0);
      expect(PUSH_TYPE_LABELS[type].length, type).toBeGreaterThan(0);
    }
  });

  it("is fixed text: nothing a lock screen should not show (no digits for a date or amount, no placeholder, no name)", () => {
    for (const type of NOTIFICATION_TYPES) {
      const { title, body } = pushCopy(type);
      for (const text of [title, body]) {
        expect(text, type).not.toMatch(/\d/);
        expect(text, type).not.toMatch(/[{}$%<>]/);
        expect(text, type).not.toMatch(/expir|licen[cs]e|certificate|passport|visa|rsa\b/i);
      }
    }
  });

  it("gives a type it does not know, from a newer server, the plain fallback", () => {
    expect(pushCopy("SOMETHING_NEW")).toEqual({ title: "CulinAIre Kitchen", body: "You have a new notification." });
  });
});
