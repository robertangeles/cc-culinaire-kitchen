import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Required-documents was a bare free-text input until a role required
 * "R.S.A" while every uploaded document was typed "RSA" — canAssign()
 * matches document types by exact string equality with no normalization,
 * so that typo would silently defeat the compliance gate: a real,
 * verified, unexpired document, refused as "missing". This tests that the
 * common case is now a pick from the canonical list, not free text, with
 * "Other" as the escape hatch for a genuinely uncommon type.
 */

const mockRoles = [{ rosterRoleId: "role-1", organisationId: 1, storeLocationId: null, roleName: "Head Chef", createdDttm: "", updatedDttm: "" }];

const getRoleDocuments = vi.fn(async (_id: string) => [] as string[]);
const setRoleDocuments = vi.fn(async (_id: string, next: string[]) => next);

vi.mock("../../hooks/useHasPermission.js", () => ({ useHasPermission: () => () => true }));
vi.mock("../../hooks/useRoster.js", () => ({
  useRosterRoles: () => ({ roles: mockRoles, isLoading: false, error: null, refresh: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() }),
  getRoleDocuments: (id: string) => getRoleDocuments(id),
  setRoleDocuments: (id: string, next: string[]) => setRoleDocuments(id, next),
}));

const { RolesManager } = await import("./RolesManager.js");

describe("RolesManager — required documents", () => {
  beforeEach(() => {
    getRoleDocuments.mockClear();
    setRoleDocuments.mockClear();
  });

  it("offers a dropdown of canonical document types, not a free-text field", async () => {
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));

    await waitFor(() => expect(getRoleDocuments).toHaveBeenCalledWith("role-1"));

    const select = await screen.findByDisplayValue("Choose a document type");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "RSA" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Food Safety Supervisor" })).toBeInTheDocument();
    // No plain free-text input for the common case.
    expect(screen.queryByPlaceholderText("e.g. RSA")).not.toBeInTheDocument();
  });

  it("adding a canonical type sends the exact list string, never a hand-typed variant", async () => {
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));
    const select = await screen.findByDisplayValue("Choose a document type");

    fireEvent.change(select, { target: { value: "RSA" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(setRoleDocuments).toHaveBeenCalledWith("role-1", ["RSA"]));
  });

  it("selecting Other reveals a free-text field for a genuinely uncommon type", async () => {
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));
    const select = await screen.findByDisplayValue("Choose a document type");

    expect(screen.queryByPlaceholderText("Name the document")).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "Other" } });
    expect(screen.getByPlaceholderText("Name the document")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Name the document"), { target: { value: "First Aid Certificate" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(setRoleDocuments).toHaveBeenCalledWith("role-1", ["First Aid Certificate"]));
  });

  it("a type already required by this role drops out of the dropdown", async () => {
    getRoleDocuments.mockResolvedValueOnce(["RSA"]);
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));

    await screen.findByDisplayValue("Choose a document type");
    expect(screen.queryByRole("option", { name: "RSA" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Food Safety Supervisor" })).toBeInTheDocument();
  });
});
