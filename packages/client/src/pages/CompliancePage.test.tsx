import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The tab shell only has to get two things right, and both are the kind that
 * fail silently rather than loudly:
 *
 *  1. It must survive AuthContext resolving AFTER the first render. `user`
 *     starts as null and is filled in by a fetch, so on the first pass nobody
 *     holds any permission and the tab list is empty. A tab seeded once via
 *     useState would capture that empty list and never re-evaluate, leaving
 *     every user — Administrators included — on the "nothing to show"
 *     fallback forever. That is a blank page for 100% of users, which is
 *     exactly why it is the first test here.
 *
 *  2. It must never mount a view whose endpoint the user cannot call. A user
 *     holding only compliance:read-own or only compliance:manage-rules can
 *     still reach this route, since neither permission unlocks a tab here
 *     any more (My Documents now lives on Profile, Requirements in Admin
 *     Settings) — the page must fall back to the "nothing to show" message
 *     for them rather than mounting the manager dashboard, which would fire
 *     read-all fetches that all 403.
 */

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));

// Stubbed so the test asserts which view is MOUNTED without any of them
// reaching for the network.
vi.mock("../components/compliance/ComplianceDashboard.js", () => ({
  ComplianceDashboard: () => <div>STUB team dashboard</div>,
}));
vi.mock("../components/compliance/VerificationView.js", () => ({
  VerificationView: () => <div>STUB verification queue</div>,
}));

const { CompliancePage } = await import("./CompliancePage.js");

/** Signed-in user carrying exactly the permissions given. */
function signedIn(permissions: string[], roles: string[] = ["Subscriber"]) {
  return { user: { userId: 1, permissions, roles }, isGuest: false };
}

describe("CompliancePage", () => {
  beforeEach(() => mockUseAuth.mockReset());

  it("still picks a tab when auth resolves after the first render", () => {
    // First render: AuthContext has not resolved. This is every page load.
    mockUseAuth.mockReturnValue({ user: null, isGuest: false });
    const view = render(<CompliancePage />);
    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();

    // Auth lands. The page must now show the dashboard, NOT the fallback.
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-all"]));
    view.rerender(<CompliancePage />);

    expect(screen.getByText("STUB team dashboard")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to show here yet/)).not.toBeInTheDocument();
  });

  it("gives a read-own-only user no tabs, since My Documents now lives on Profile", () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-own"]));
    render(<CompliancePage />);

    // Mounting either would fire a 403 fetch on their behalf.
    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("STUB verification queue")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing to show here yet/)).toBeInTheDocument();
  });

  it("gives an Administrator both tabs without granting them explicitly", () => {
    mockUseAuth.mockReturnValue(signedIn([], ["Administrator"]));
    render(<CompliancePage />);

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Defaults to Team, preserving what this page did before it had tabs.
    expect(screen.getByText("STUB team dashboard")).toBeInTheDocument();
  });

  it("gives a manage-rules-only user no tabs, since Requirements now lives in Admin Settings", () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:manage-rules"]));
    render(<CompliancePage />);

    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();
    expect(screen.queryByText("STUB verification queue")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing to show here yet/)).toBeInTheDocument();
  });

  it("mounts only the selected tab's view", () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-all", "compliance:verify"]));
    render(<CompliancePage />);

    expect(screen.getByText("STUB team dashboard")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /verify/i }));

    expect(screen.getByText("STUB verification queue")).toBeInTheDocument();
    expect(screen.queryByText("STUB team dashboard")).not.toBeInTheDocument();
  });

  it("asks a signed-out visitor to sign in", () => {
    mockUseAuth.mockReturnValue({ user: null, isGuest: true });
    render(<CompliancePage />);
    expect(screen.getByText(/Sign in to view staff compliance status/)).toBeInTheDocument();
  });
});
