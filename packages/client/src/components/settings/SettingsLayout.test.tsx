import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// SettingsLayout gates the Compliance tab on a permission, so every test
// needs this stubbed — the real hook requires an AuthProvider ancestor none
// of these renders have. Defaults to "granted" so the pre-existing tests
// below (written before the gate existed) keep seeing every tab.
const hasPermissionMock = vi.fn();
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => hasPermissionMock,
}));

// Award Rules / Document Expiry Rules also gate on the Administrator role
// directly (requireAdministrator field), not just a permission — so every
// test needs this stubbed too. Defaults to Administrator so pre-existing
// tests (written before this gate existed) keep seeing every tab.
const useAuthMock = vi.fn();
vi.mock("../../context/AuthContext.js", () => ({
  useAuth: () => useAuthMock(),
}));

import {
  SettingsLayout,
  groupTabs,
  orderedTabs,
  type SettingsGroup,
} from "./SettingsLayout.js";

beforeEach(() => {
  hasPermissionMock.mockReset().mockReturnValue(true);
  useAuthMock.mockReset().mockReturnValue({ user: { roles: ["Administrator"] } });
});

type Fixture = { id: string; group?: SettingsGroup };

describe("groupTabs", () => {
  it("returns one bucket per group in fixed order: web, mobile, rosteringCompliance, shared, unassigned", () => {
    const items: Fixture[] = [
      { id: "a", group: "shared" },
      { id: "b", group: "web" },
      { id: "c", group: "mobile" },
      { id: "d" },
    ];
    const out = groupTabs(items).map((g) => g.id);
    expect(out).toEqual(["web", "mobile", "rosteringCompliance", "shared", "unassigned"]);
  });

  it("preserves declaration order within each group", () => {
    const items: Fixture[] = [
      { id: "a", group: "web" },
      { id: "b", group: "shared" },
      { id: "c", group: "web" },
      { id: "d", group: "shared" },
    ];
    const web = groupTabs(items).find((g) => g.id === "web")!;
    const shared = groupTabs(items).find((g) => g.id === "shared")!;
    expect(web.items.map((t) => t.id)).toEqual(["a", "c"]);
    expect(shared.items.map((t) => t.id)).toEqual(["b", "d"]);
  });

  it("falls a missing group through to 'unassigned'", () => {
    const items: Fixture[] = [{ id: "x" }];
    const unassigned = groupTabs(items).find((g) => g.id === "unassigned")!;
    expect(unassigned.items).toHaveLength(1);
    expect(unassigned.items[0].id).toBe("x");
  });

  it("returns empty buckets for groups with no tabs", () => {
    const items: Fixture[] = [{ id: "a", group: "web" }];
    const mobile = groupTabs(items).find((g) => g.id === "mobile")!;
    expect(mobile.items).toEqual([]);
  });
});

describe("orderedTabs", () => {
  it("flattens groups in web -> mobile -> rosteringCompliance -> shared -> unassigned order", () => {
    const items: Fixture[] = [
      { id: "z" },
      { id: "s", group: "shared" },
      { id: "r", group: "rosteringCompliance" },
      { id: "w", group: "web" },
      { id: "m", group: "mobile" },
    ];
    expect(orderedTabs(items).map((t) => t.id)).toEqual(["w", "m", "r", "s", "z"]);
  });
});

describe("SettingsLayout — rendered shell", () => {
  it("always renders Web, Mobile, and Shared, plus Rostering & Compliance when it has visible tabs, and elides empty Unassigned", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    expect(screen.getByRole("heading", { name: "Web" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rostering & Compliance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shared" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unassigned" })).toBeNull();
  });

  it("hides the Rostering & Compliance group entirely when the viewer holds none of its tabs' permissions", () => {
    hasPermissionMock.mockReturnValue(false);
    useAuthMock.mockReturnValue({ user: { roles: ["Subscriber"] } });
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    expect(screen.queryByRole("heading", { name: "Rostering & Compliance" })).toBeNull();
  });

  it("renders the Mobile Pages tab inside the Mobile group", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    const mobileGroup = screen.getByRole("group", { name: "Mobile" });
    expect(within(mobileGroup).getByRole("tab", { name: /Pages/ })).toBeInTheDocument();
  });

  it("renders every tab from the registry as a tab role", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // Two "Pages" tabs (web, mobile) intentionally share their label — check
    // those by id, not label.
    expect(document.getElementById("settings-tab-prompts")).toBeInTheDocument();
    expect(document.getElementById("settings-tab-pages")).toBeInTheDocument();
    expect(document.getElementById("settings-tab-mobilePages")).toBeInTheDocument();

    const uniqueLabels = [
      "Site Settings",
      "Appearance",
      "Users",
      "Roles",
      "Integrations",
      "Models",
      "Knowledge Base",
      "The Bench",
      "User Guide",
    ];
    for (const label of uniqueLabels) {
      expect(screen.getByRole("tab", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("places the disabled Models tab inside its declared group with a Soon badge", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    const sharedGroup = screen.getByRole("group", { name: "Shared" });
    expect(within(sharedGroup).getByRole("tab", { name: /Models/ })).toBeDisabled();
    expect(within(sharedGroup).getByText("Soon")).toBeInTheDocument();
  });

  it("ArrowDown moves selection to the next enabled tab, crossing group boundaries", () => {
    const onTabChange = vi.fn();
    render(
      <SettingsLayout activeTab="brain" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // brain is the last Web tab in the registry. ArrowDown should cross into
    // the Mobile group (its sole tab — mobilePages).
    const brainTab = screen.getByRole("tab", { name: /Brain/ });
    fireEvent.keyDown(brainTab, { key: "ArrowDown" });

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0]).toBe("mobilePages");
  });

  it("ArrowUp wraps from the first enabled tab back to the last enabled tab", () => {
    const onTabChange = vi.fn();
    render(
      <SettingsLayout activeTab="siteSettings" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // siteSettings is the first Web tab. ArrowUp should wrap to the last
    // enabled tab in the visual order (last Shared tab — "knowledge").
    const siteSettingsTab = screen.getByRole("tab", { name: /Site Settings/ });
    fireEvent.keyDown(siteSettingsTab, { key: "ArrowUp" });

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0]).toBe("knowledge");
  });

  it("ArrowDown from the last Mobile tab lands on the collapsed Rostering & Compliance entry's first tab", () => {
    const onTabChange = vi.fn();
    render(
      <SettingsLayout activeTab="mobilePages" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // "Pages" is ambiguous (web + mobile both use the label) — target by id.
    fireEvent.keyDown(document.getElementById("settings-tab-mobilePages")!, { key: "ArrowDown" });

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0]).toBe("compliance");
  });

  it("ArrowDown while a Rostering & Compliance tab is active treats the whole group as one stop and moves to the next group's first tab", () => {
    const onTabChange = vi.fn();
    render(
      <SettingsLayout activeTab="documentExpiryRules" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // The collapsed sidebar entry is the focusable element while any of the
    // 4 rostering tabs is active — not the (unfocused) tab strip button.
    fireEvent.keyDown(screen.getByRole("tab", { name: "Rostering & Compliance" }), { key: "ArrowDown" });

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0]).toBe("prompts");
  });

  it("ArrowUp while a Rostering & Compliance tab is active treats the whole group as one stop and moves to the previous group's last tab", () => {
    const onTabChange = vi.fn();
    render(
      <SettingsLayout activeTab="documentExpiryRules" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: "Rostering & Compliance" }), { key: "ArrowUp" });

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0]).toBe("mobilePages"); // Mobile's only tab
  });

  it("does not render the Rostering & Compliance tab strip when a non-rostering tab is active", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    expect(screen.queryByRole("tablist", { name: "Rostering & Compliance" })).not.toBeInTheDocument();
  });
});

describe("SettingsLayout — Compliance tab gating", () => {
  it("shows Compliance, as the first tab in Rostering & Compliance, when the user holds compliance:manage-rules", () => {
    hasPermissionMock.mockImplementation((...keys: string[]) => keys.includes("compliance:manage-rules"));
    useAuthMock.mockReturnValue({ user: { roles: ["Administrator"] } });
    render(
      <SettingsLayout activeTab="compliance" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    const strip = screen.getByRole("tablist", { name: "Rostering & Compliance" });
    const idsInOrder = within(strip)
      .getAllByRole("tab")
      .map((el) => el.id);
    expect(idsInOrder[0]).toBe("settings-tab-compliance");
  });

  it("hides Compliance entirely when the user lacks compliance:manage-rules", () => {
    hasPermissionMock.mockReturnValue(false);
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    expect(document.getElementById("settings-tab-compliance")).toBeNull();
  });

  it("does not disturb the rest of the tab list or grouping either way", () => {
    hasPermissionMock.mockReturnValue(false);
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    expect(screen.getByRole("heading", { name: "Web" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shared" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unassigned" })).toBeNull();
    // Users and Roles — unaffected by Compliance's gate, and unaffected by
    // Compliance living in a different group entirely.
    expect(screen.getByRole("tab", { name: /Users/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Roles/ })).toBeInTheDocument();
  });
});

describe("SettingsLayout — Rostering & Compliance group", () => {
  it("collapses to a single sidebar entry, active whenever any of its 4 tabs is selected", () => {
    hasPermissionMock.mockReturnValue(true);
    useAuthMock.mockReturnValue({ user: { roles: ["Administrator"] } });
    render(
      <SettingsLayout activeTab="awardRules" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    const group = screen.getByRole("group", { name: "Rostering & Compliance" });
    const groupTab = within(group).getByRole("tab", { name: "Rostering & Compliance" });
    expect(groupTab).toHaveAttribute("aria-selected", "true");
  });

  it("holds Compliance, Public Holidays, Award Rules, and Document Expiry Rules together, in that order, as a tab strip in the content pane", () => {
    hasPermissionMock.mockReturnValue(true);
    useAuthMock.mockReturnValue({ user: { roles: ["Administrator"] } });
    render(
      <SettingsLayout activeTab="compliance" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    const strip = screen.getByRole("tablist", { name: "Rostering & Compliance" });
    const labelsInOrder = within(strip)
      .getAllByRole("tab")
      .map((el) => el.textContent);
    expect(labelsInOrder).toEqual([
      "Compliance",
      "Public Holidays",
      "Award Rules",
      "Document Expiry Rules",
    ]);
  });

  it("clicking the collapsed sidebar entry jumps to its first visible tab", () => {
    const onTabChange = vi.fn();
    hasPermissionMock.mockReturnValue(true);
    useAuthMock.mockReturnValue({ user: { roles: ["Administrator"] } });
    render(
      <SettingsLayout activeTab="prompts" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Rostering & Compliance" }));
    expect(onTabChange).toHaveBeenCalledWith("compliance");
  });
});

describe("SettingsLayout — Award Rules / Document Expiry Rules gating (permission AND Administrator)", () => {
  it("shows both tabs to an Administrator holding both permissions", () => {
    hasPermissionMock.mockReturnValue(true);
    useAuthMock.mockReturnValue({ user: { roles: ["Administrator"] } });
    render(
      <SettingsLayout activeTab="compliance" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );
    expect(document.getElementById("settings-tab-awardRules")).toBeInTheDocument();
    expect(document.getElementById("settings-tab-documentExpiryRules")).toBeInTheDocument();
  });

  it("hides both tabs from a non-Administrator EVEN THOUGH they hold the permission — the authority-blast-radius fix itself", () => {
    hasPermissionMock.mockReturnValue(true); // holds roster:manage-award-rules / compliance:manage-rules
    useAuthMock.mockReturnValue({ user: { roles: ["Operations Admin"] } });
    render(
      // compliance has no requireAdministrator gate, so it's the one visible
      // tab this role can land on to open the Rostering & Compliance strip.
      <SettingsLayout activeTab="compliance" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );
    expect(document.getElementById("settings-tab-awardRules")).toBeNull();
    expect(document.getElementById("settings-tab-documentExpiryRules")).toBeNull();
  });

  it("hides both tabs from an Administrator who lacks the permission — Administrator role alone is not enough either", () => {
    hasPermissionMock.mockReturnValue(false);
    useAuthMock.mockReturnValue({ user: { roles: ["Administrator"] } });
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );
    // No permission is held, so the whole Rostering & Compliance group is
    // empty and never renders — its tabs can't appear under any activeTab.
    expect(document.getElementById("settings-tab-awardRules")).toBeNull();
    expect(document.getElementById("settings-tab-documentExpiryRules")).toBeNull();
  });
});
