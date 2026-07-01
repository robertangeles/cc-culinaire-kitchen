import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { RequirePermission } from "./RequirePermission.js";

// Mock the shared permission hook so we can drive allow/deny deterministically.
const hasPermissionMock = vi.fn();
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => hasPermissionMock,
}));

function renderGuard(anyOf: string[]) {
  return render(
    <MemoryRouter>
      <RequirePermission anyOf={anyOf}>
        <div>secret content</div>
      </RequirePermission>
    </MemoryRouter>,
  );
}

describe("RequirePermission", () => {
  it("renders children when the user holds a required permission", () => {
    hasPermissionMock.mockReturnValue(true);
    renderGuard(["menu:read"]);
    expect(screen.getByText("secret content")).toBeInTheDocument();
    expect(screen.queryByText(/isn't on your plan/i)).not.toBeInTheDocument();
  });

  it("renders the access-denied panel (not the children) when the permission is missing", () => {
    hasPermissionMock.mockReturnValue(false);
    renderGuard(["menu:read"]);
    expect(screen.queryByText("secret content")).not.toBeInTheDocument();
    expect(screen.getByText(/isn't on your plan/i)).toBeInTheDocument();
    // Offers a way back rather than dead-ending.
    expect(screen.getByRole("link", { name: /Ask Antoine/i })).toBeInTheDocument();
  });

  it("forwards all required permission keys to the hook (OR semantics)", () => {
    hasPermissionMock.mockReturnValue(true);
    renderGuard(["inventory:count", "inventory:manage"]);
    expect(hasPermissionMock).toHaveBeenCalledWith("inventory:count", "inventory:manage");
  });
});
