import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const hasPermissionMock = vi.fn();
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => hasPermissionMock,
}));

const { CoverageDisclosure } = await import("./PublishPanel.js");

describe("CoverageDisclosure — 'Add rules now' link", () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
  });

  it("renders the link when there's an uncovered gap AND the viewer holds roster:manage-award-rules", () => {
    hasPermissionMock.mockReturnValue(true);
    render(
      <CoverageDisclosure
        coverage={{ checked: ["max_ordinary_hours"], notChecked: ["min_break"], ruleVersionsInScope: [], jurisdiction: null }}
      />,
    );
    const link = screen.getByRole("link", { name: "Add rules now" });
    expect(link).toHaveAttribute("href", "/settings?tab=awardRules");
  });

  it("does NOT render the link when everything is already checked (notChecked is empty)", () => {
    hasPermissionMock.mockReturnValue(true);
    render(
      <CoverageDisclosure
        coverage={{ checked: ["max_ordinary_hours", "publish_notice"], notChecked: [], ruleVersionsInScope: [], jurisdiction: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: "Add rules now" })).toBeNull();
  });

  it("does NOT render the link for a viewer without roster:manage-award-rules, even with a real gap", () => {
    hasPermissionMock.mockReturnValue(false);
    render(
      <CoverageDisclosure
        coverage={{ checked: [], notChecked: ["max_ordinary_hours", "publish_notice"], ruleVersionsInScope: [], jurisdiction: null }}
      />,
    );
    expect(screen.queryByRole("link", { name: "Add rules now" })).toBeNull();
  });
});
