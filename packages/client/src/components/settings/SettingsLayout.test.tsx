import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  SettingsLayout,
  groupTabs,
  orderedTabs,
  type SettingsGroup,
} from "./SettingsLayout.js";

type Fixture = { id: string; group?: SettingsGroup };

describe("groupTabs", () => {
  it("returns one bucket per group in fixed order: web, mobile, shared, unassigned", () => {
    const items: Fixture[] = [
      { id: "a", group: "shared" },
      { id: "b", group: "web" },
      { id: "c", group: "mobile" },
      { id: "d" },
    ];
    const out = groupTabs(items).map((g) => g.id);
    expect(out).toEqual(["web", "mobile", "shared", "unassigned"]);
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
  it("flattens groups in web -> mobile -> shared -> unassigned order", () => {
    const items: Fixture[] = [
      { id: "z" },
      { id: "s", group: "shared" },
      { id: "w", group: "web" },
      { id: "m", group: "mobile" },
    ];
    expect(orderedTabs(items).map((t) => t.id)).toEqual(["w", "m", "s", "z"]);
  });
});

describe("SettingsLayout — rendered shell", () => {
  it("always renders the three primary groups (Web, Mobile, Shared) and elides empty Unassigned", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    expect(screen.getByRole("heading", { name: "Web" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Mobile" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shared" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Unassigned" })).toBeNull();
  });

  it("renders the Mobile Prompts tab inside the Mobile group", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    const mobileGroup = screen.getByRole("group", { name: "Mobile" });
    expect(within(mobileGroup).getByRole("tab", { name: /Prompts/ })).toBeInTheDocument();
  });

  it("renders every tab from the registry as a tab role", () => {
    render(
      <SettingsLayout activeTab="prompts" onTabChange={() => {}}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // Two "Prompts" tabs (web, mobile) and two "Pages" tabs (web, mobile)
    // intentionally share their label — check those by id, not label.
    expect(document.getElementById("settings-tab-prompts")).toBeInTheDocument();
    expect(document.getElementById("settings-tab-mobilePrompts")).toBeInTheDocument();
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
      <SettingsLayout activeTab="userGuide" onTabChange={onTabChange}>
        <div>panel</div>
      </SettingsLayout>,
    );

    // userGuide is the last Web tab in the draft registry. ArrowDown should
    // cross into the Mobile group (its sole tab — mobilePrompts).
    const userGuideTab = screen.getByRole("tab", { name: /User Guide/ });
    fireEvent.keyDown(userGuideTab, { key: "ArrowDown" });

    expect(onTabChange).toHaveBeenCalledTimes(1);
    expect(onTabChange.mock.calls[0][0]).toBe("mobilePrompts");
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
});
