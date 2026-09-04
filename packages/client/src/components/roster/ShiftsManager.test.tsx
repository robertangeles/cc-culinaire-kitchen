import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * ShiftsManager wiring around the 129h/157h roster-incident fix:
 * the create-form gate that blocks submission on an unconfirmed long shift,
 * and the new Edit action on a Draft shift row. ShiftTimeFields.test.tsx
 * already covers the warning/threshold math in isolation — this file covers
 * the surrounding component actually enforcing the gate and wiring update().
 */

const create = vi.fn(async (_d: any) => ({}));
const update = vi.fn(async (_id: string, _d: any) => ({}));

let mockShifts: any[] = [];
let mockCanManage = true;

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({
    locations: [{ storeLocationId: "loc-1", organisationId: 1 }],
    selectedLocationId: "loc-1",
  }),
}));

vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => () => mockCanManage,
}));

vi.mock("../../hooks/useRoster.js", () => ({
  useShifts: () => ({
    shifts: mockShifts,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    create,
    update,
    cancel: vi.fn(),
    assign: vi.fn(),
    removeAssignment: vi.fn(),
  }),
  useRosterRoles: () => ({ roles: [{ rosterRoleId: "role-1", roleName: "Cook" }] }),
  useOrgMembers: () => ({ members: [] }),
  fetchShiftAssignments: vi.fn(async () => []),
  requestConsent: vi.fn(async () => {}),
}));

const { ShiftsManager } = await import("./ShiftsManager.js");

const draftShift = {
  shiftId: "shift-1",
  organisationId: 1,
  storeLocationId: "loc-1",
  rosterRoleId: "role-1",
  startDatetime: "2026-09-07T08:00:00.000Z",
  endDatetime: "2026-09-07T17:00:00.000Z",
  isPublicHoliday: false,
  status: "Draft" as const,
  createdBy: 1,
  createdDttm: "2026-09-01T00:00:00.000Z",
  updatedDttm: "2026-09-01T00:00:00.000Z",
};

beforeEach(() => {
  create.mockClear();
  update.mockClear();
  mockShifts = [draftShift];
  mockCanManage = true;
});

describe("ShiftsManager create-form gate", () => {
  it("blocks Create on an unconfirmed long shift, then allows it once confirmed", async () => {
    render(<ShiftsManager />);
    fireEvent.click(screen.getByRole("button", { name: /new shift/i }));

    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "role-1" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-09-07T08:00" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-09-13T21:00" } });

    const createButton = screen.getByRole("button", { name: "Create" });
    expect(createButton).toBeDisabled();
    fireEvent.click(createButton);
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/I confirm this is correct/));
    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        storeLocationId: "loc-1",
        rosterRoleId: "role-1",
        startDatetime: new Date("2026-09-07T08:00").toISOString(),
        endDatetime: new Date("2026-09-13T21:00").toISOString(),
      }),
    );
  });
});

describe("ShiftsManager edit action gating", () => {
  it("hides the Edit action for a user without roster:manage", () => {
    mockCanManage = false;
    render(<ShiftsManager />);
    expect(screen.queryByLabelText("Edit shift time")).not.toBeInTheDocument();
  });

  it("hides the Edit action for a Published shift", () => {
    mockShifts = [{ ...draftShift, status: "Published" }];
    render(<ShiftsManager />);
    expect(screen.queryByLabelText("Edit shift time")).not.toBeInTheDocument();
  });
});

describe("ShiftsManager edit action", () => {
  it("saves an edited end time on a Draft shift", async () => {
    render(<ShiftsManager />);
    fireEvent.click(screen.getByLabelText("Edit shift time"));

    const newEnd = "2026-09-07T19:00";
    fireEvent.change(screen.getByLabelText("End"), { target: { value: newEnd } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      // startDatetime round-trips through the datetime-local input untouched
      // (minute precision, :00 seconds) regardless of the runner's TZ.
      expect(update).toHaveBeenCalledWith("shift-1", {
        startDatetime: draftShift.startDatetime,
        endDatetime: new Date(newEnd).toISOString(),
      }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument());
  });

  it("shows the server's refusal message and keeps the panel open on failure", async () => {
    update.mockRejectedValueOnce(new Error("Only a Draft shift can be edited"));
    render(<ShiftsManager />);
    fireEvent.click(screen.getByLabelText("Edit shift time"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Only a Draft shift can be edited")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
