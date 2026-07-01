/**
 * Tests for the role-aware nav filter. The sidebar is only as "built for me"
 * as this filter is correct, so we assert exact visibility per viewer.
 */

import { describe, it, expect } from "vitest";
import { NAV_SECTIONS, filterNav, isItemVisible, type NavContext } from "./navConfig.js";

/** Flatten a filtered nav into a flat list of item ids for easy assertions. */
function visibleIds(ctx: NavContext): string[] {
  return filterNav(NAV_SECTIONS, ctx).flatMap((s) => s.items.map((i) => i.id));
}

const guest: NavContext = { isAuthenticated: false, isGuest: true, permissions: [], roles: [] };
const lineCook: NavContext = {
  isAuthenticated: true,
  isGuest: false,
  // A custom BOH role: can count stock and run prep, but no menu/waste/purchasing.
  permissions: ["chat:access", "inventory:count", "prep:manage"],
  roles: ["Line Cook"],
};
const owner: NavContext = {
  isAuthenticated: true,
  isGuest: false,
  permissions: [
    "inventory:count",
    "purchasing:draft",
    "menu:read",
    "waste:read",
    "prep:manage",
  ],
  roles: ["Owner"],
};
// Administrator with an EMPTY permission list — the superuser bypass must still
// show everything.
const admin: NavContext = {
  isAuthenticated: true,
  isGuest: false,
  permissions: [],
  roles: ["Administrator"],
};

describe("isItemVisible", () => {
  it("guest-ok is always visible", () => {
    expect(isItemVisible("guest-ok", guest)).toBe(true);
    expect(isItemVisible("guest-ok", owner)).toBe(true);
  });

  it("auth requires an authenticated user", () => {
    expect(isItemVisible("auth", guest)).toBe(false);
    expect(isItemVisible("auth", lineCook)).toBe(true);
  });

  it("permission gate requires a matching permission on an authed user", () => {
    expect(isItemVisible({ anyPermission: ["menu:read"] }, lineCook)).toBe(false);
    expect(isItemVisible({ anyPermission: ["menu:read"] }, owner)).toBe(true);
    // Never visible to guests even if the permission array were present.
    expect(isItemVisible({ anyPermission: ["menu:read"] }, guest)).toBe(false);
  });
});

describe("filterNav", () => {
  it("guest sees only public modules; Run the Kitchen group is hidden", () => {
    const ids = visibleIds(guest);
    expect(ids).toContain("chat");
    expect(ids).toContain("recipe-lab");
    expect(ids).toContain("the-bench");
    expect(ids).not.toContain("stock-room");
    expect(ids).not.toContain("menu-costing");
    // No orphan "Run the Kitchen" header.
    const sectionIds = filterNav(NAV_SECTIONS, guest).map((s) => s.id);
    expect(sectionIds).not.toContain("run-the-kitchen");
  });

  it("line cook sees line tools only — no menu/waste/ordering", () => {
    const ids = visibleIds(lineCook);
    expect(ids).toEqual(
      expect.arrayContaining(["chat", "recipe-lab", "my-recipe-book", "stock-room", "prep"]),
    );
    expect(ids).not.toContain("menu-costing");
    expect(ids).not.toContain("waste");
    expect(ids).not.toContain("ordering");
  });

  it("owner sees the full Run the Kitchen group", () => {
    const ids = visibleIds(owner);
    expect(ids).toEqual(
      expect.arrayContaining(["stock-room", "ordering", "menu-costing", "prep", "waste"]),
    );
  });

  it("Administrator sees every item via the superuser bypass, even with no permissions", () => {
    const ids = visibleIds(admin);
    const allIds = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.id));
    expect(ids.sort()).toEqual(allIds.sort());
  });

  it("empty/undefined permissions never crash and yield only base items", () => {
    const bare = { isAuthenticated: true, isGuest: false } as unknown as NavContext;
    const ids = visibleIds(bare);
    expect(ids).toContain("chat");
    expect(ids).toContain("my-recipe-book"); // auth-gated, no permission needed
    expect(ids).not.toContain("stock-room"); // needs a permission
  });
});
