import { describe, it, expect } from "vitest";
import type { AuthUser } from "../api/auth";
import { canOpen, hasAnyPermission, homeHref, MAX_TABS, moduleTabs, tabBar, tabLabels, visibleTabs } from "./tabs";

/** The tabs a permission opens, leaving out those every signed-in person gets. */
const gatedTabs = (user: AuthUser) => visibleTabs(user).filter((t) => t.anyPermission);

const person = (over: Partial<AuthUser> = {}): AuthUser => ({ userId: 1, userName: "A", userEmail: "a@x.test", mfaEnabled: false, roles: [], permissions: [], ...over });

describe("which tabs a person sees", () => {
  it("shows the Count tab to someone who holds inventory:count", () => {
    expect(gatedTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toContain("(count)");
  });

  it("shows the Usage and Move tabs to someone who holds inventory:count, the key the server asks for on both, and to no one without it", () => {
    expect(gatedTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toEqual(["(usage)", "(count)", "(moves)", "(transfers)", "(stock)"]);
    expect(gatedTabs(person({ permissions: ["waste:log", "inventory:manage", "inventory:hq", "inventory:transfer"] })).map((t) => t.route)).toEqual(["(waste)"]);
  });

  it("shows the Waste tab to someone who holds waste:log, and only that: waste:read alone is the web's reports, not on the phone", () => {
    expect(gatedTabs(person({ permissions: ["waste:log"] })).map((t) => t.route)).toEqual(["(waste)"]);
    expect(gatedTabs(person({ permissions: ["waste:read"] }))).toEqual([]);
    expect(gatedTabs(person({ permissions: ["inventory:count", "waste:log"] })).map((t) => t.route)).toEqual(["(waste)", "(usage)", "(count)", "(moves)", "(transfers)", "(stock)"]);
  });

  it("shows the Prep tab to someone who holds prep:read or prep:manage, as the server lets either tick tasks (any role can be given them)", () => {
    expect(gatedTabs(person({ permissions: ["prep:read"] })).map((t) => t.route)).toEqual(["(prep)"]);
    expect(gatedTabs(person({ permissions: ["prep:manage"] })).map((t) => t.route)).toEqual(["(prep)"]);
    expect(gatedTabs(person({ permissions: ["inventory:count", "waste:log", "prep:read"] })).map((t) => t.route)).toEqual(["(prep)", "(waste)", "(usage)", "(count)", "(moves)", "(transfers)", "(stock)"]);
    expect(gatedTabs(person({ permissions: ["waste:read", "menu:manage"] }))).toEqual([]);
  });

  it("shows the Receive tab to someone who holds purchasing:receive, with or without Count", () => {
    expect(gatedTabs(person({ permissions: ["purchasing:receive"] })).map((t) => t.route)).toEqual(["(receive)"]);
    const both = visibleTabs(person({ permissions: ["inventory:count", "purchasing:receive"] })).map((t) => t.route);
    expect(both).toContain("(count)");
    expect(both).toContain("(receive)");
  });

  it("shows the Orders tab to anyone who raises, submits, approves or credits; someone who only receives has Receive, the only orders the server lists for them", () => {
    for (const key of ["purchasing:draft", "purchasing:submit", "purchasing:approve", "purchasing:credit"]) expect(gatedTabs(person({ permissions: [key] })).map((t) => t.route)).toEqual(["(orders)"]);
    expect(gatedTabs(person({ permissions: ["inventory:count", "inventory:manage"] })).map((t) => t.route)).not.toContain("(orders)");
  });

  it("shows no module to someone with only unrelated permissions, or none", () => {
    expect(gatedTabs(person({ permissions: ["chat:access"] }))).toEqual([]);
    expect(gatedTabs(person())).toEqual([]);
  });

  it("shows every tab to an Administrator, who holds every permission implicitly", () => {
    expect(visibleTabs(person({ roles: ["Administrator"] }))).toEqual(moduleTabs);
  });

  it("shows Ask, Recipes, the Inbox and the Bench to everyone signed in, as the server asks for no permission on chat, recipes, notifications or the Bench", () => {
    expect(visibleTabs(person()).map((t) => t.route)).toEqual(["(chat)", "(recipes)", "(inbox)", "(bench)"]);
    expect(visibleTabs(person({ permissions: ["waste:log"] })).map((t) => t.route)).toEqual(["(waste)", "(chat)", "(recipes)", "(inbox)", "(bench)"]);
  });

  it("opens a tab on any one of its permissions", () => {
    const tab = { ...moduleTabs[0], anyPermission: ["a:read", "a:write"] };
    expect(canOpen(person({ permissions: ["a:write"] }), tab)).toBe(true);
    expect(canOpen(person({ permissions: ["b:read"] }), tab)).toBe(false);
  });

  it("shows Transfers and Stock to someone who holds inventory:count, the key the server asks for to list and receive transfers and to read the dashboard, and to no one who holds only manage", () => {
    expect(gatedTabs(person({ permissions: ["inventory:count"] })).map((t) => t.route)).toEqual(expect.arrayContaining(["(transfers)", "(stock)"]));
    expect(gatedTabs(person({ permissions: ["inventory:manage", "inventory:cost"] }))).toEqual([]);
  });

  it("shows the Menu to someone who holds menu:read, the key on every menu route, and to no one who holds only menu:manage", () => {
    expect(gatedTabs(person({ permissions: ["menu:read"] })).map((t) => t.route)).toEqual(["(menu)"]);
    expect(gatedTabs(person({ permissions: ["menu:manage", "inventory:cost"] }))).toEqual([]);
  });

  it("shows the Brain to someone who holds brain:read, the key the server asks for to list memories, and to no one who holds only brain:manage", () => {
    expect(gatedTabs(person({ permissions: ["brain:read"] })).map((t) => t.route)).toEqual(["(brain)"]);
    expect(gatedTabs(person({ permissions: ["brain:manage"] }))).toEqual([]);
  });

  it("does not treat a role name other than Administrator as a superuser", () => {
    expect(hasAnyPermission(person({ roles: ["Paid Subscriber"] }), ["inventory:count"])).toBe(false);
  });

  it("has one entry per route group", () => {
    expect(new Set(moduleTabs.map((t) => t.route)).size).toBe(moduleTabs.length);
  });

  it("puts the tabs in the order a line cook uses them (prep, waste, usage, count, move, receive, orders), then Ask, Recipes and the Inbox, then the weekly store-room Transfers and Stock, then the Menu, then the Brain and the Bench", () => {
    expect(moduleTabs.map((t) => t.title)).toEqual(["Prep", "Waste", "Usage", "Count", "Move", "Receive", "Orders", "Ask", "Recipes", "Inbox", "Transfers", "Stock", "Menu", "Brain", "Bench"]);
  });
});

describe("the tab bar and More", () => {
  it("keeps every module and Account on the bar when they fit in five buttons", () => {
    // One module of their own takes a person past five: the first four stay where they were, the Bench and Account go under More.
    const cook = person({ permissions: ["waste:log"] });
    expect(tabBar(cook).bar.map((t) => t.title)).toEqual(["Waste", "Ask", "Recipes", "Inbox"]);
    expect(tabBar(cook).more.map((t) => t.title)).toEqual(["Bench"]);
    expect(tabBar(person())).toEqual({ bar: visibleTabs(person()), more: [] });
  });

  it("shows four modules and More when a person's modules and Account would make more than five buttons", () => {
    const { bar, more } = tabBar(person({ roles: ["Administrator"] }));
    expect(bar.map((t) => t.title)).toEqual(["Prep", "Waste", "Usage", "Count"]);
    expect(more.map((t) => t.title)).toEqual(["Move", "Receive", "Orders", "Ask", "Recipes", "Inbox", "Transfers", "Stock", "Menu", "Brain", "Bench"]);
    expect(bar.length + 1).toBe(MAX_TABS); // the fifth button is More, which also holds Account
  });

  it("never puts a module the person cannot open under More", () => {
    const cook = person({ permissions: ["inventory:count", "waste:log", "prep:read"] });
    const { bar, more } = tabBar(cook);
    expect([...bar, ...more]).toEqual(visibleTabs(cook));
  });

  it("numbers each button for VoiceOver by its place among the buttons that show, not among every screen", () => {
    expect(tabLabels(person({ roles: ["Administrator"] }))).toEqual({
      Prep: "Prep, tab, 1 of 5",
      Waste: "Waste, tab, 2 of 5",
      Usage: "Usage, tab, 3 of 5",
      Count: "Count, tab, 4 of 5",
      More: "More, tab, 5 of 5",
    });
    // No module permission: Ask, Recipes, the Inbox and the Bench, which everyone gets, then Account; More has no button.
    expect(tabLabels(person())).toEqual({ Ask: "Ask, tab, 1 of 5", Recipes: "Recipes, tab, 2 of 5", Inbox: "Inbox, tab, 3 of 5", Bench: "Bench, tab, 4 of 5", Account: "Account, tab, 5 of 5" });
  });

  it("opens the signed-in app on the first button of the person's bar, named with its group so a bare / cannot open Ask instead", () => {
    expect(homeHref(person({ roles: ["Administrator"] }))).toBe("/(prep)");
    expect(homeHref(person({ permissions: ["waste:log", "inventory:count"] }))).toBe("/(waste)");
    expect(homeHref(person({ permissions: ["purchasing:receive"] }))).toBe("/(receive)");
    expect(homeHref(person())).toBe("/(chat)");
  });
});
