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
const canManage = vi.fn(() => true);

vi.mock("../../hooks/useHasPermission.js", () => ({ useHasPermission: () => canManage }));
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
    canManage.mockReturnValue(true);
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

  it("Add stays disabled with nothing selected, and with Other selected but no name typed", async () => {
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));
    const select = await screen.findByDisplayValue("Choose a document type");
    const addButton = screen.getByRole("button", { name: "Add" });

    expect(addButton).toBeDisabled();

    fireEvent.change(select, { target: { value: "Other" } });
    expect(addButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Name the document"), { target: { value: "   " } });
    expect(addButton).toBeDisabled();

    fireEvent.click(addButton);
    expect(setRoleDocuments).not.toHaveBeenCalled();
  });

  it("typing a near-duplicate of a canonical type under Other is refused, not silently saved", async () => {
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));
    const select = await screen.findByDisplayValue("Choose a document type");
    fireEvent.change(select, { target: { value: "Other" } });

    fireEvent.change(screen.getByPlaceholderText("Name the document"), { target: { value: "R.S.A" } });

    expect(screen.getByText(/Did you mean.*RSA/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(setRoleDocuments).not.toHaveBeenCalled();
  });

  it("typing a near-duplicate of an already-required custom type under Other is refused, not silently saved", async () => {
    getRoleDocuments.mockResolvedValueOnce(["First Aid Certificate"]);
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));
    const select = await screen.findByDisplayValue("Choose a document type");
    fireEvent.change(select, { target: { value: "Other" } });

    fireEvent.change(screen.getByPlaceholderText("Name the document"), {
      target: { value: "first aid certificate" },
    });

    expect(screen.getByText(/Did you mean.*First Aid Certificate/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(setRoleDocuments).not.toHaveBeenCalled();
  });

  it("without roster:manage, required documents render read-only — no dropdown, no Add, no remove", async () => {
    canManage.mockReturnValue(false);
    getRoleDocuments.mockResolvedValueOnce(["RSA"]);
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));

    await screen.findByText("RSA");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Remove RSA")).not.toBeInTheDocument();
  });

  it("shows an error message when loading requirements fails", async () => {
    getRoleDocuments.mockRejectedValueOnce(new Error("Failed to load requirements"));
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));

    await waitFor(() => expect(screen.getByText("Failed to load requirements")).toBeInTheDocument());
  });

  it("shows an error message when saving a new requirement fails", async () => {
    setRoleDocuments.mockRejectedValueOnce(new Error("Network error"));
    render(<RolesManager />);
    fireEvent.click(screen.getByText("Head Chef"));
    const select = await screen.findByDisplayValue("Choose a document type");

    fireEvent.change(select, { target: { value: "RSA" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(screen.getByText("Network error")).toBeInTheDocument());
  });
});
