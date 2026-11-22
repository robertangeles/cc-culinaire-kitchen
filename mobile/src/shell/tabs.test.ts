import { describe, it, expect } from "vitest";
import type { AuthUser } from "../api/auth";
import { canOpen, hasAnyPermission, moduleTabs, visibleTabs } from "./tabs";

const person = (over: Partial<AuthUser> = {}): AuthUser => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles: [], permissions: [], ...over });

describe("which tabs a person sees", () => {
  it("shows the Count tab to someone who holds inventory:count", () => {
    expect(visibleTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toEqual(["(count)"]);
  });

  it("shows no module to someone with only unrelated permissions, or none", () => {
    expect(visibleTabs(person({ permissions: ["chat:access"] }))).toEqual([]);
    expect(visibleTabs(person())).toEqual([]);
  });

  it("shows every tab to an Administrator, who holds every permission implicitly", () => {
    expect(visibleTabs(person({ roles: ["Administrator"] }))).toEqual(moduleTabs);
  });

  it("opens a tab on any one of its permissions", () => {
    const tab = { ...moduleTabs[0], anyPermission: ["a:read", "a:write"] };
    expect(canOpen(person({ permissions: ["a:write"] }), tab)).toBe(true);
    expect(canOpen(person({ permissions: ["b:read"] }), tab)).toBe(false);
  });

  it("does not treat a role name other than Administrator as a superuser", () => {
    expect(hasAnyPermission(person({ roles: ["Paid Subscriber"] }), ["inventory:count"])).toBe(false);
  });

  it("has one entry per route group", () => {
    expect(new Set(moduleTabs.map((t) => t.route)).size).toBe(moduleTabs.length);
  });
});
