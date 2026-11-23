import { describe, it, expect } from "vitest";
import type { AuthUser } from "../api/auth";
import { canOpen, hasAnyPermission, moduleTabs, visibleTabs } from "./tabs";

const person = (over: Partial<AuthUser> = {}): AuthUser => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles: [], permissions: [], ...over });

describe("which tabs a person sees", () => {
  it("shows the Count tab to someone who holds inventory:count", () => {
    expect(visibleTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toContain("(count)");
  });

  it("shows the Usage and Move tabs to someone who holds inventory:count, the key the server asks for on both, and to no one without it", () => {
    expect(visibleTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toEqual(["(count)", "(usage)", "(moves)"]);
    expect(visibleTabs(person({ permissions: ["waste:log", "inventory:manage", "inventory:hq", "inventory:transfer"] })).map((t) => t.route)).toEqual(["(waste)"]);
  });

  it("shows the Waste tab to someone who holds waste:log, and only that: waste:read alone is the web's reports, not on the phone", () => {
    expect(visibleTabs(person({ permissions: ["waste:log"] })).map((t) => t.route)).toEqual(["(waste)"]);
    expect(visibleTabs(person({ permissions: ["waste:read"] }))).toEqual([]);
    expect(visibleTabs(person({ permissions: ["inventory:count", "waste:log"] })).map((t) => t.route)).toEqual(["(count)", "(waste)", "(usage)", "(moves)"]);
  });

  it("shows the Prep tab to someone who holds prep:read or prep:manage, as the server lets either tick tasks (any role can be given them)", () => {
    expect(visibleTabs(person({ permissions: ["prep:read"] })).map((t) => t.route)).toEqual(["(prep)"]);
    expect(visibleTabs(person({ permissions: ["prep:manage"] })).map((t) => t.route)).toEqual(["(prep)"]);
    expect(visibleTabs(person({ permissions: ["inventory:count", "waste:log", "prep:read"] })).map((t) => t.route)).toEqual(["(count)", "(waste)", "(prep)"]);
    expect(visibleTabs(person({ permissions: ["waste:read", "menu:read"] }))).toEqual([]);
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
