import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Star } from "lucide-react";
import { PillTabs } from "./PillTabs.js";

const TABS = [
  { id: "a", label: "Alpha", icon: Star },
  { id: "b", label: "Beta", badge: <span>3</span>, tooltip: "Beta tip" },
  { id: "c", label: "Gamma" },
];

function setup(active = "a") {
  const onChange = vi.fn();
  render(<PillTabs tabs={TABS} active={active} onChange={onChange} ariaLabel="Test tabs" idPrefix="t" activeClassName="on" inactiveClassName="off" />);
  return { onChange, tab: (name: string) => screen.getByRole("tab", { name: new RegExp(name) }) };
}

describe("PillTabs", () => {
  it("renders a labelled tablist with one tab per entry and aria-selected on the active one", () => {
    const { tab } = setup("b");
    expect(screen.getByRole("tablist", { name: "Test tabs" })).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(tab("Beta")).toHaveAttribute("aria-selected", "true");
    expect(tab("Alpha")).toHaveAttribute("aria-selected", "false");
  });

  it("wires id and aria-controls from idPrefix", () => {
    const { tab } = setup();
    expect(tab("Alpha")).toHaveAttribute("id", "t-tab-a");
    expect(tab("Alpha")).toHaveAttribute("aria-controls", "t-tabpanel-a");
  });

  it("calls onChange with the id on click", () => {
    const { onChange, tab } = setup();
    fireEvent.click(tab("Gamma"));
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("uses roving tabindex: only the active tab is in the tab order", () => {
    const { tab } = setup("b");
    expect(tab("Beta")).toHaveAttribute("tabindex", "0");
    expect(tab("Alpha")).toHaveAttribute("tabindex", "-1");
    expect(tab("Gamma")).toHaveAttribute("tabindex", "-1");
  });

  it("falls back to the first tab being tabbable when active matches nothing", () => {
    const { tab } = setup("zzz");
    expect(tab("Alpha")).toHaveAttribute("tabindex", "0");
  });

  it("ArrowRight selects and focuses the next tab, wrapping at the end", () => {
    const { onChange, tab } = setup("a");
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(tab("Beta"));
    fireEvent.keyDown(tab("Gamma"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(tab("Alpha"));
  });

  it("ArrowLeft selects the previous tab, wrapping at the start", () => {
    const { onChange, tab } = setup("a");
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(tab("Gamma"));
  });

  it("Home and End jump to the first and last tab", () => {
    const { onChange, tab } = setup("b");
    fireEvent.keyDown(tab("Beta"), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(tab("Beta"), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("ignores other keys", () => {
    const { onChange, tab } = setup("a");
    fireEvent.keyDown(tab("Alpha"), { key: "ArrowDown" });
    fireEvent.keyDown(tab("Alpha"), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives every tab the 44px minimum height", () => {
    setup();
    for (const t of screen.getAllByRole("tab")) expect(t.className).toContain("min-h-11");
  });

  it("renders the badge inside the tab", () => {
    const { tab } = setup();
    expect(tab("Beta").textContent).toContain("3");
  });
});
