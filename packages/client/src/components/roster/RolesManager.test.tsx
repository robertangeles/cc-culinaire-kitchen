import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Regression for the silent-409 bug: deleting a role blocked by the server
 * (409, e.g. still used by a saved template or a scheduled shift) used to
 * throw an uncaught rejection with zero UI feedback. RoleRow must now catch
 * it and show the server's message next to the row.
 */

const create = vi.fn(async () => ({}));
const update = vi.fn(async (_id: string, _data: unknown) => {});
const remove = vi.fn(async (_id: string) => {});

let mockCanManage = true;
let mockRoles: { rosterRoleId: string; roleName: string; storeLocationId: string | null }[] = [
  { rosterRoleId: "role-1", roleName: "Barista", storeLocationId: null },
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
    create,
    update,
    remove,
  }),
  getRoleDocuments: vi.fn(async () => []),
  setRoleDocuments: vi.fn(async (_id: string, next: string[]) => next),
}));

const { RolesManager } = await import("./RolesManager.js");

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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "loc-branch" } });
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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "loc-branch" } });
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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "loc-branch" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(screen.getByText(/Templates at other venues/)).toBeInTheDocument());

    // Changing the venue again must clear the stale warning, not leave
    // "Save anyway" wired to a selection the warning was never computed for.
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });

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

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "loc-branch" } });
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(screen.getByText(/Templates at other venues/)).toBeInTheDocument());

    fireEvent.click(screen.getByText("Cancel"));

    // Reverted to the role's actual original venue (this describe block's
    // fixture — see beforeEach above), not just the warning dismissed —
    // otherwise "Save changes" reappears right underneath for a change the
    // user just cancelled.
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("loc-hq");
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument();
    expect(screen.queryByText(/Templates at other venues/)).not.toBeInTheDocument();
  });
});
