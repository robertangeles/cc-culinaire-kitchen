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
 *
 * Also covers the silent-409 bug: deleting a role blocked by the server
 * (409, e.g. still used by a saved template or a scheduled shift) used to
 * throw an uncaught rejection with zero UI feedback. RoleRow must now catch
 * it and show the server's message next to the row.
 */

const getRoleDocuments = vi.fn(async (_id: string) => [] as string[]);
const setRoleDocuments = vi.fn(async (_id: string, next: string[]) => next);
const create = vi.fn(async () => ({}));
const update = vi.fn(async (_id: string, _data: unknown) => {});
const remove = vi.fn(async (_id: string) => {});

let mockCanManage = true;
let mockRoles: { rosterRoleId: string; roleName: string; storeLocationId: string | null }[] = [
  { rosterRoleId: "role-1", roleName: "Head Chef", storeLocationId: null },
];

vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => () => mockCanManage,
}));

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({
    locations: [
      { storeLocationId: "loc-hq", locationName: "HQ" },
      { storeLocationId: "loc-branch", locationName: "Branch" },
    ],
  }),
}));

vi.mock("../../hooks/useRoster.js", () => ({
  useRosterRoles: () => ({
    roles: mockRoles,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    create,
    update,
    remove,
  }),
  getRoleDocuments: (id: string) => getRoleDocuments(id),
  setRoleDocuments: (id: string, next: string[]) => setRoleDocuments(id, next),
}));

const { RolesManager } = await import("./RolesManager.js");

describe("RolesManager — required documents", () => {
  beforeEach(() => {
    mockCanManage = true;
    mockRoles = [{ rosterRoleId: "role-1", roleName: "Head Chef", storeLocationId: null }];
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
    mockCanManage = false;
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

describe("RolesManager — delete blocked by server (409)", () => {
  beforeEach(() => {
    mockCanManage = true;
    mockRoles = [{ rosterRoleId: "role-1", roleName: "Barista", storeLocationId: null }];
    remove.mockReset();
    update.mockReset();
    create.mockReset();
  });

  it("shows the server's message next to the row instead of failing silently", async () => {
    remove.mockRejectedValueOnce(new Error("Cannot delete a role used in a saved weekly template"));
    render(<RolesManager />);

    fireEvent.click(screen.getByLabelText("Delete role"));

    await waitFor(() =>
      expect(screen.getByText("Cannot delete a role used in a saved weekly template")).toBeInTheDocument(),
    );
    expect(screen.getByText("Barista")).toBeInTheDocument();
  });

  it("does not show a stale error after a successful delete", async () => {
    remove.mockResolvedValueOnce(undefined);
    render(<RolesManager />);

    fireEvent.click(screen.getByLabelText("Delete role"));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("role-1"));
    expect(screen.queryByText(/Cannot delete/)).not.toBeInTheDocument();
  });
});

describe("RolesManager — venue picker (Add form)", () => {
  beforeEach(() => {
    mockCanManage = true;
    mockRoles = [];
    create.mockReset();
  });

  it("submits create() with the selected venue's storeLocationId", async () => {
    create.mockResolvedValueOnce({});
    render(<RolesManager />);

    fireEvent.click(screen.getByText("Add role"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Bartender"), { target: { value: "Bartender" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "loc-hq" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ roleName: "Bartender", storeLocationId: "loc-hq" }),
    );
  });

  it("submits null storeLocationId when 'All venues' stays selected", async () => {
    create.mockResolvedValueOnce({});
    render(<RolesManager />);

    fireEvent.click(screen.getByText("Add role"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Bartender"), { target: { value: "Bartender" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => expect(create).toHaveBeenCalledWith({ roleName: "Bartender", storeLocationId: null }));
  });
});

describe("RolesManager — venue badge (collapsed row)", () => {
  beforeEach(() => {
    mockCanManage = true;
  });

  it("shows a venue badge when storeLocationId is non-null", () => {
    mockRoles = [{ rosterRoleId: "role-1", roleName: "Barista", storeLocationId: "loc-hq" }];
    render(<RolesManager />);
    expect(screen.getByText("HQ only")).toBeInTheDocument();
  });

  it("shows no badge for an org-wide role", () => {
    mockRoles = [{ rosterRoleId: "role-1", roleName: "Barista", storeLocationId: null }];
    render(<RolesManager />);
    expect(screen.queryByText(/only$/)).not.toBeInTheDocument();
  });
});

describe("RolesManager — RoleRow venue edit + cross-venue warning", () => {
  beforeEach(() => {
    mockCanManage = true;
    mockRoles = [{ rosterRoleId: "role-1", roleName: "Barista", storeLocationId: "loc-hq" }];
    update.mockReset();
  });

  function expandRow() {
    fireEvent.click(screen.getByText("Barista"));
  }

  it("saves directly when there is no conflict", async () => {
    update.mockResolvedValueOnce(undefined);
    render(<RolesManager />);
    expandRow();

    fireEvent.change(screen.getByRole("combobox", { name: "Venue" }), { target: { value: "loc-branch" } });
    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("role-1", {
        roleName: "Barista",
        storeLocationId: "loc-branch",
        confirmed: false,
      }),
    );
  });

  it("shows the warning with conflicting venues on a conflict, and 'Save anyway' resubmits confirmed:true", async () => {
    const conflictErr = Object.assign(new Error("This role is used by templates at other venues"), {
      conflicts: [{ storeLocationId: "loc-hq", locationName: "HQ" }],
    });
    update.mockRejectedValueOnce(conflictErr).mockResolvedValueOnce(undefined);
    render(<RolesManager />);
    expandRow();

    fireEvent.change(screen.getByRole("combobox", { name: "Venue" }), { target: { value: "loc-branch" } });
    fireEvent.click(screen.getByText("Save changes"));

    await waitFor(() => expect(screen.getByText(/Templates at other venues.*HQ/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save anyway"));

    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith("role-1", {
        roleName: "Barista",
        storeLocationId: "loc-branch",
        confirmed: true,
      }),
    );
  });

  it("resets the warning back to a plain editable state when the venue changes again", async () => {
    const conflictErr = Object.assign(new Error("This role is used by templates at other venues"), {
      conflicts: [{ storeLocationId: "loc-hq", locationName: "HQ" }],
    });
    update.mockRejectedValueOnce(conflictErr);
    render(<RolesManager />);
    expandRow();

    fireEvent.change(screen.getByRole("combobox", { name: "Venue" }), { target: { value: "loc-branch" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(screen.getByText(/Templates at other venues/)).toBeInTheDocument());

    // Changing the venue again must clear the stale warning, not leave
    // "Save anyway" wired to a selection the warning was never computed for.
    fireEvent.change(screen.getByRole("combobox", { name: "Venue" }), { target: { value: "" } });

    expect(screen.queryByText(/Templates at other venues/)).not.toBeInTheDocument();
    expect(screen.queryByText("Save anyway")).not.toBeInTheDocument();
    expect(screen.getByText("Save changes")).toBeInTheDocument();
  });

  it("Cancel on the conflict warning reverts the venue selection, not just dismisses the warning", async () => {
    const conflictErr = Object.assign(new Error("This role is used by templates at other venues"), {
      conflicts: [{ storeLocationId: "loc-hq", locationName: "HQ" }],
    });
    update.mockRejectedValueOnce(conflictErr);
    render(<RolesManager />);
    expandRow();

    fireEvent.change(screen.getByRole("combobox", { name: "Venue" }), { target: { value: "loc-branch" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(screen.getByText(/Templates at other venues/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("Cancel"));

    // Reverted to the role's actual original venue (this describe block's
    // fixture — see beforeEach above), not just the warning dismissed —
    // otherwise "Save changes" reappears right underneath for a change the
    // user just cancelled.
    expect((screen.getByRole("combobox", { name: "Venue" }) as HTMLSelectElement).value).toBe("loc-hq");
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
    expect(screen.queryByText(/Templates at other venues/)).not.toBeInTheDocument();
  });
});
