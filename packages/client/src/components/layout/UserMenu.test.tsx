import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The role badge under the user's name in the sidebar account menu: shows
 * `user.roles[0]`, the user's single most-privileged role. Ordering `roles[]`
 * most-privileged-first is authService.ts's job (getUserWithRolesAndPermissions
 * orders by permission count descending — see authService.integration.test.ts)
 * — this component just trusts that order and displays the first entry. Do
 * NOT re-sort or re-rank roles here; that would duplicate a decision that
 * only the server has the data (per-role permission counts) to make correctly.
 */

const mockUseAuth = vi.fn();
vi.mock("../../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

const { UserMenu } = await import("./UserMenu.js");

function signedIn(roles: string[]) {
  return { user: { userId: 1, userName: "Alex Charasse", userPhotoPath: null, roles, permissions: [] }, logout: vi.fn() };
}

describe("UserMenu — role badge", () => {
  beforeEach(() => mockUseAuth.mockReset());

  it("shows the single role for a user with only one", () => {
    mockUseAuth.mockReturnValue(signedIn(["Subscriber"]));
    render(<UserMenu />);
    expect(screen.getByText("Subscriber")).toBeInTheDocument();
  });

  it("shows only roles[0] (the server's most-privileged-first order) for a user holding more than one", () => {
    mockUseAuth.mockReturnValue(signedIn(["Operations Admin", "Subscriber"]));
    render(<UserMenu />);
    expect(screen.getByText("Operations Admin")).toBeInTheDocument();
    expect(screen.queryByText(/Subscriber/)).not.toBeInTheDocument();
  });

  it("renders nothing when there is no signed-in user", () => {
    mockUseAuth.mockReturnValue({ user: null, logout: vi.fn() });
    const { container } = render(<UserMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it("Admin Settings menu item appears only for an Administrator", () => {
    mockUseAuth.mockReturnValue(signedIn(["Subscriber", "Operations Admin"]));
    render(<UserMenu />);
    fireEvent.click(screen.getByText("Alex Charasse"));
    expect(screen.queryByText("Admin Settings")).not.toBeInTheDocument();
  });
});
