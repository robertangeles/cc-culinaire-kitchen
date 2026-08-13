import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * My Documents is gated on compliance:read-own so the tab and its endpoint
 * (MyDocumentsTab → /api/compliance/documents/mine) never disagree — even
 * though in practice every staff member holds the permission. This only has
 * to prove the gate actually gates: the tab (and the network calls behind
 * it) must not appear for someone who lacks the permission.
 */

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));

// Stubbed so the test asserts the tab is mounted without MyDocumentsTab's
// own subtree (MyDocumentsList) reaching for the network.
vi.mock("../components/compliance/MyDocumentsTab.js", () => ({
  MyDocumentsTab: () => <div>STUB my documents</div>,
}));

const { ProfilePage } = await import("./ProfilePage.js");

/** Signed-in user carrying exactly the permissions given. */
function signedIn(permissions: string[], roles: string[] = ["Subscriber"]) {
  return { user: { userId: 1, userName: "Test User", permissions, roles }, refreshUser: vi.fn() };
}

describe("ProfilePage — My Documents tab", () => {
  beforeEach(() => mockUseAuth.mockReset());

  it("shows the tab and its content for a user holding compliance:read-own", async () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-own"]));
    render(<ProfilePage />);

    const tab = screen.getByRole("tab", { name: /my documents/i });
    fireEvent.click(tab);

    await waitFor(() => expect(screen.getByText("STUB my documents")).toBeInTheDocument());
  });

  it("hides the tab entirely for a user without compliance:read-own", async () => {
    mockUseAuth.mockReturnValue(signedIn([]));
    render(<ProfilePage />);

    // Profile's own mount-time fetches (profile/org) settle asynchronously;
    // wait for them so the assertion below isn't racing a pending update.
    await waitFor(() => expect(screen.getByRole("tab", { name: /account details/i })).toBeInTheDocument());
    expect(screen.queryByRole("tab", { name: /my documents/i })).not.toBeInTheDocument();
  });
});
