import { describe, it, expect } from "vitest";
import type { AuthUser } from "../api/auth";
import { canOpen, hasAnyPermission, MAX_TABS, moduleTabs, tabBar, visibleTabs } from "./tabs";

/** The tabs a permission opens, leaving out those every signed-in person gets. */
const gatedTabs = (user: AuthUser) => visibleTabs(user).filter((t) => t.anyPermission);

const person = (over: Partial<AuthUser> = {}): AuthUser => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles: [], permissions: [], ...over });

describe("which tabs a person sees", () => {
  it("shows the Count tab to someone who holds inventory:count", () => {
    expect(gatedTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toContain("(count)");
  });

  it("shows the Usage and Move tabs to someone who holds inventory:count, the key the server asks for on both, and to no one without it", () => {
    expect(gatedTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toEqual(["(usage)", "(count)", "(moves)"]);
    expect(gatedTabs(person({ permissions: ["waste:log", "inventory:manage", "inventory:hq", "inventory:transfer"] })).map((t) => t.route)).toEqual(["(waste)"]);
  });

  it("shows the Waste tab to someone who holds waste:log, and only that: waste:read alone is the web's reports, not on the phone", () => {
    expect(gatedTabs(person({ permissions: ["waste:log"] })).map((t) => t.route)).toEqual(["(waste)"]);
    expect(gatedTabs(person({ permissions: ["waste:read"] }))).toEqual([]);
    expect(gatedTabs(person({ permissions: ["inventory:count", "waste:log"] })).map((t) => t.route)).toEqual(["(waste)", "(usage)", "(count)", "(moves)"]);
  });

  it("shows the Prep tab to someone who holds prep:read or prep:manage, as the server lets either tick tasks (any role can be given them)", () => {
    expect(gatedTabs(person({ permissions: ["prep:read"] })).map((t) => t.route)).toEqual(["(prep)"]);
    expect(gatedTabs(person({ permissions: ["prep:manage"] })).map((t) => t.route)).toEqual(["(prep)"]);
    expect(gatedTabs(person({ permissions: ["inventory:count", "waste:log", "prep:read"] })).map((t) => t.route)).toEqual(["(prep)", "(waste)", "(usage)", "(count)", "(moves)"]);
    expect(gatedTabs(person({ permissions: ["waste:read", "menu:read"] }))).toEqual([]);
  });

  it("shows the Receive tab to someone who holds purchasing:receive, with or without Count", () => {
    expect(gatedTabs(person({ permissions: ["purchasing:receive"] })).map((t) => t.route)).toEqual(["(receive)"]);
    const both = visibleTabs(person({ permissions: ["inventory:count", "purchasing:receive"] })).map((t) => t.route);
    expect(both).toContain("(count)");
    expect(both).toContain("(receive)");
  });

  it("shows no module to someone with only unrelated permissions, or none", () => {
    expect(gatedTabs(person({ permissions: ["chat:access"] }))).toEqual([]);
    expect(gatedTabs(person())).toEqual([]);
  });

  it("shows every tab to an Administrator, who holds every permission implicitly", () => {
    expect(visibleTabs(person({ roles: ["Administrator"] }))).toEqual(moduleTabs);
  });

  it("shows Ask and Recipes to everyone signed in, as the server asks for no permission on chat or recipes", () => {
    expect(visibleTabs(person()).map((t) => t.route)).toEqual(["(chat)", "(recipes)"]);
    expect(visibleTabs(person({ permissions: ["waste:log"] })).map((t) => t.route)).toEqual(["(waste)", "(chat)", "(recipes)"]);
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

  it("puts the tabs in the order a line cook uses them: prep, waste, usage, count, move, receive", () => {
    expect(moduleTabs.map((t) => t.title)).toEqual(["Prep", "Waste", "Usage", "Count", "Move", "Receive"]);
  });
});

describe("the tab bar and More", () => {
  it("keeps every module and Account on the bar when they fit in five buttons", () => {
    const cook = person({ permissions: ["inventory:count", "waste:log"] });
    expect(tabBar(cook)).toEqual({ bar: visibleTabs(cook), more: [] });
    expect(tabBar(person())).toEqual({ bar: [], more: [] });
  });

  it("shows four modules and More when a person's modules and Account would make more than five buttons", () => {
    const { bar, more } = tabBar(person({ roles: ["Administrator"] }));
    expect(bar.map((t) => t.title)).toEqual(["Prep", "Waste", "Usage", "Count"]);
    expect(more.map((t) => t.title)).toEqual(["Move", "Receive"]);
    expect(bar.length + 1).toBe(MAX_TABS); // the fifth button is More, which also holds Account
  });

  it("never puts a module the person cannot open under More", () => {
    const cook = person({ permissions: ["inventory:count", "waste:log", "prep:read"] });
    const { bar, more } = tabBar(cook);
    expect([...bar, ...more]).toEqual(visibleTabs(cook));
  });
});
