import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * Ported from the former pages/CompliancePage.test.tsx when Team Compliance
 * moved into the Organisation page. The tab shell only has to get two things
 * right, and both are the kind that fail silently rather than loudly:
 *
 *  1. It must survive AuthContext resolving AFTER the first render. `user`
 *     starts as null and is filled in by a fetch, so on the first pass nobody
 *     holds any permission and the tab list is empty. A tab seeded once via
 *     useState would capture that empty list and never re-evaluate, leaving
 *     every user — Administrators included — on the "nothing to show"
 *     fallback forever. That is a blank tab for 100% of users, which is
 *     exactly why it is the first test here.
 *
 *  2. It must never mount a view whose endpoint the user cannot call. A user
 *     holding only compliance:read-own or only compliance:manage-rules can
 *     still reach the Organisation page (via compliance:read-all/verify held
 *     elsewhere, or org:manage-organisation), but neither of those two keys
 *     unlocks a tab HERE — the page must fall back to "nothing to show"
 *     rather than mounting the manager dashboard, which would fire read-all
 *     fetches that all 403.
 */

const mockUseAuth = vi.fn();
vi.mock("../../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("../compliance/ComplianceDashboard.js", () => ({
  ComplianceDashboard: () => <div>STUB team dashboard</div>,
}));
vi.mock("../compliance/VerificationView.js", () => ({
  VerificationView: () => <div>STUB verification queue</div>,
}));

const { TeamComplianceSection } = await import("./TeamComplianceSection.js");

/** Signed-in user carrying exactly the permissions given. */
function signedIn(permissions: string[], roles: string[] = ["Subscriber"]) {
  return { user: { userId: 1, permissions, roles }, isGuest: false };
}

describe("TeamComplianceSection", () => {
  beforeEach(() => mockUseAuth.mockReset());

  it("still picks a tab when auth resolves after the first render", () => {
    mockUseAuth.mockReturnValue({ user: null, isGuest: false });
    const view = render(<TeamComplianceSection />);
    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();

    mockUseAuth.mockReturnValue(signedIn(["compliance:read-all"]));
    view.rerender(<TeamComplianceSection />);

    expect(screen.getByText("STUB team dashboard")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to show here yet/)).not.toBeInTheDocument();
  });

  it("gives a read-own-only user no tabs, since My Documents lives on Profile", () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-own"]));
    render(<TeamComplianceSection />);

    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("STUB verification queue")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing to show here yet/)).toBeInTheDocument();
  });

  it("gives an Administrator both tabs without granting them explicitly", () => {
    mockUseAuth.mockReturnValue(signedIn([], ["Administrator"]));
    render(<TeamComplianceSection />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText("STUB team dashboard")).toBeInTheDocument();
  });

  it("gives a manage-rules-only user no tabs, since Requirements lives in Admin Settings", () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:manage-rules"]));
    render(<TeamComplianceSection />);

    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("STUB verification queue")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing to show here yet/)).toBeInTheDocument();
  });

  it("mounts only the selected tab's view", () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-all", "compliance:verify"]));
    render(<TeamComplianceSection />);

    expect(screen.getByText("STUB team dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /verify/i }));

    expect(screen.getByText("STUB verification queue")).toBeInTheDocument();
    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();
  });
});
