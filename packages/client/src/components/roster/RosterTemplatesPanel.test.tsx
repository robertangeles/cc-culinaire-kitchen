import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * RosterTemplatesToolbar + its three modals (Manage Templates, Generate This
 * Week, Undo Last Generation) — the UI placement /plan-design-review locked
 * inline on the Calendar tab (2026-09-07). useRosterTemplates itself is
 * already covered end to end by useRosterTemplates.test.ts; this file covers
 * the component wiring on top of it (mocked here).
 */

const create = vi.fn(async (_d: any) => ({}));
const update = vi.fn(async (_id: string, _d: any) => ({}));
const remove = vi.fn(async (_id: string) => {});
const generateWeek = vi.fn(async (_w: string) => ({ created: 2, skipped: 1, failed: 0 }));
const undoGeneration = vi.fn(async (_w: string) => ({ cancelled: 2 }));

let mockTemplates: any[] = [];

vi.mock("../../hooks/useRoster.js", () => ({
  useRosterTemplates: () => ({
    templates: mockTemplates,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    create,
    update,
    remove,
    generateWeek,
    undoGeneration,
  }),
}));

const { RosterTemplatesToolbar } = await import("./RosterTemplatesPanel.js");

const venueRoles = [
  { rosterRoleId: "role-1", organisationId: 1, storeLocationId: "loc-1", roleName: "Server", createdDttm: "", updatedDttm: "" },
  { rosterRoleId: "role-2", organisationId: 1, storeLocationId: "loc-1", roleName: "Bartender", createdDttm: "", updatedDttm: "" },
];

const templateRow = {
  rosterShiftTemplateId: "t-1",
  organisationId: 1,
  storeLocationId: "loc-1",
  rosterRoleId: "role-1",
  dayOfWeek: 1,
  startTime: "09:00",
  endTime: "17:00",
  createdDttm: "",
  updatedDttm: "",
};

function renderToolbar(onGenerated = vi.fn()) {
  render(
    <RosterTemplatesToolbar storeLocationId="loc-1" venueRoles={venueRoles as any} weekStart="2027-03-01" onGenerated={onGenerated} />,
  );
  return onGenerated;
}

beforeEach(() => {
  create.mockClear();
  update.mockClear();
  remove.mockClear();
  generateWeek.mockClear();
  undoGeneration.mockClear();
  mockTemplates = [];
});

describe("RosterTemplatesToolbar", () => {
  it("renders the three template actions", () => {
    renderToolbar();
    expect(screen.getByText("Manage Templates")).toBeInTheDocument();
    expect(screen.getByText("Generate This Week")).toBeInTheDocument();
    expect(screen.getByText("Undo Last Generation")).toBeInTheDocument();
  });

  it("Manage Templates modal shows the empty state when there are no rows, and its CTA opens the add form", () => {
    renderToolbar();
    fireEvent.click(screen.getByText("Manage Templates"));
    expect(screen.getByText("No templates yet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Create your first template row"));
    expect(screen.getByText("Role")).toBeInTheDocument();
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("shows a hint (not a bare empty dropdown) when zero roles are valid for this venue", () => {
    render(
      <RosterTemplatesToolbar storeLocationId="loc-1" venueRoles={[]} weekStart="2027-03-01" onGenerated={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Manage Templates"));
    expect(screen.getByText("No roles exist for this venue yet — add one from the Roles tab.")).toBeInTheDocument();
    expect(screen.queryByText("Create your first template row")).not.toBeInTheDocument();
  });

  it("adding a row calls create() with the form's values", async () => {
    renderToolbar();
    fireEvent.click(screen.getByText("Manage Templates"));
    fireEvent.click(screen.getByText("Add Template Row"));

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "role-2" } });
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        storeLocationId: "loc-1",
        rosterRoleId: "role-2",
        dayOfWeek: 2,
        startTime: "10:00",
        endTime: "18:00",
      }),
    );
  });

  it("rejects saving when start and end time are equal, without calling create()", async () => {
    renderToolbar();
    fireEvent.click(screen.getByText("Manage Templates"));
    fireEvent.click(screen.getByText("Add Template Row"));

    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "09:00" } }); // matches the default start time
    fireEvent.click(screen.getByText("Save"));

    expect(await screen.findByText("Start and end time cannot be the same")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("lists an existing row grouped under its day, and edit populates the form", () => {
    mockTemplates = [templateRow];
    renderToolbar();
    fireEvent.click(screen.getByText("Manage Templates"));

    expect(screen.getByText("Monday")).toBeInTheDocument();
    expect(screen.getByText("Server")).toBeInTheDocument();
    expect(screen.getByText("09:00 – 17:00")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Edit Server on Monday"));
    expect(screen.getByDisplayValue("09:00")).toBeInTheDocument();
  });

  it("delete calls remove() with the row's id", async () => {
    mockTemplates = [templateRow];
    renderToolbar();
    fireEvent.click(screen.getByText("Manage Templates"));

    fireEvent.click(screen.getByLabelText("Delete Server on Monday"));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("t-1"));
  });

  it("Generate This Week posts the selected week, shows the result, and refreshes the calendar", async () => {
    const onGenerated = renderToolbar();
    fireEvent.click(screen.getByText("Generate This Week"));

    fireEvent.click(screen.getByText("Generate"));

    await waitFor(() => expect(generateWeek).toHaveBeenCalledWith("2027-03-01"));
    expect(await screen.findByText("Created 2, skipped 1.")).toBeInTheDocument();
    expect(onGenerated).toHaveBeenCalled();
  });

  it("Undo Last Generation requires an explicit confirm step before cancelling anything", async () => {
    const onGenerated = renderToolbar();
    fireEvent.click(screen.getByText("Undo Last Generation"));

    // The destructive action is not called on the first click.
    fireEvent.click(screen.getByText("Undo Generation"));
    expect(undoGeneration).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Confirm — cancel these shifts"));
    await waitFor(() => expect(undoGeneration).toHaveBeenCalledWith("2027-03-01"));
    expect(await screen.findByText("Cancelled 2 shifts.")).toBeInTheDocument();
    expect(onGenerated).toHaveBeenCalled();
  });
});
