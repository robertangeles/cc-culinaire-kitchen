import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { PublicHoliday } from "../../hooks/useRoster.js";

/**
 * PublicHolidaysTab had zero test coverage before the jurisdiction+year
 * filter/table redesign (docs/specs/public-holidays-filters-plan.md). This
 * suite covers every branch in that plan's Test Coverage diagram, with two
 * load-bearing regressions called out explicitly:
 *  - handleAdd's jurisdiction default and post-save filter switch are NEW
 *    behavior on an EXISTING function (IRON RULE regression test).
 *  - a holiday saved outside the active filter must never silently
 *    disappear — that was the design review's critical finding.
 */

const hasPermissionMock = vi.fn();
vi.mock("../../hooks/useHasPermission.js", () => ({
  useHasPermission: () => hasPermissionMock,
}));

const listPublicHolidaysMock = vi.fn();
const createPublicHolidayMock = vi.fn();
const deletePublicHolidayMock = vi.fn();
vi.mock("../../hooks/useRoster.js", () => ({
  listPublicHolidays: (...args: unknown[]) => listPublicHolidaysMock(...args),
  createPublicHoliday: (...args: unknown[]) => createPublicHolidayMock(...args),
  deletePublicHoliday: (...args: unknown[]) => deletePublicHolidayMock(...args),
}));

const { PublicHolidaysTab } = await import("./PublicHolidaysTab.js");

function holiday(overrides: Partial<PublicHoliday> = {}): PublicHoliday {
  return {
    publicHolidayId: "h1",
    jurisdiction: "NSW",
    holidayDate: "2026-01-01",
    holidayName: "New Year's Day",
    isRegional: false,
    regionNote: null,
    sourceCitation: null,
    loadedForYear: 2026,
    partialDayFromTime: null,
    createdDttm: "2026-01-01T00:00:00Z",
    updatedDttm: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Stubs the org fetch. `defaultJurisdiction: null` matches an org that has never set one. */
function stubOrgFetch(defaultJurisdiction: string | null = null) {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: async () => ({ organisation: { defaultJurisdiction } }),
    }),
  ) as unknown as typeof fetch;
}

const CURRENT_YEAR = new Date().getFullYear();
const REAL_FETCH = global.fetch;

describe("PublicHolidaysTab", () => {
  beforeEach(() => {
    hasPermissionMock.mockReset().mockReturnValue(true);
    listPublicHolidaysMock.mockReset();
    createPublicHolidayMock.mockReset();
    deletePublicHolidayMock.mockReset();
    stubOrgFetch(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    // stubOrgFetch assigns global.fetch directly (not via vi.spyOn), so
    // restoreAllMocks can't undo it — restore explicitly to avoid leaking
    // a dead mock into other test files sharing this worker.
    global.fetch = REAL_FETCH;
  });

  it("shows a loading spinner, then the ready content", async () => {
    listPublicHolidaysMock.mockResolvedValue([]);
    const { container } = render(<PublicHolidaysTab />);
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());
  });

  it("shows the retry banner on a load failure, and retrying re-fetches", async () => {
    listPublicHolidaysMock.mockRejectedValueOnce(new Error("network down"));
    render(<PublicHolidaysTab />);
    await waitFor(() =>
      expect(screen.getByText(/couldn't load the public holiday calendar/i)).toBeInTheDocument(),
    );

    listPublicHolidaysMock.mockResolvedValueOnce([holiday()]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());
  });

  it("brand-new org (zero years loaded anywhere): Year select shows only the current year, lands on the global-empty state", async () => {
    listPublicHolidaysMock.mockResolvedValue([]);
    render(<PublicHolidaysTab />);

    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());
    expect(
      screen.getByText("Publishing a roster will block until the venue's jurisdiction and year are loaded here."),
    ).toBeInTheDocument();
    const yearSelect = screen.getByLabelText("Year") as HTMLSelectElement;
    expect(within(yearSelect).getAllByRole("option")).toHaveLength(1);
    expect(yearSelect.value).toBe(String(CURRENT_YEAR));
  });

  it("defaults the jurisdiction filter to NSW when the org has no default_jurisdiction", async () => {
    stubOrgFetch(null);
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "true");
  });

  it("defaults the jurisdiction filter to the org's default_jurisdiction when set", async () => {
    stubOrgFetch("VIC");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "vic1", jurisdiction: "VIC", loadedForYear: CURRENT_YEAR }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "VIC" })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "VIC" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "false");
  });

  it("falls back to NSW when the org fetch fails (network error)", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "true"));
  });

  it("falls back to NSW when the org fetch returns a non-ok response", async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "true"));
  });

  it("falls back to NSW when the org's default_jurisdiction is outside the known list", async () => {
    stubOrgFetch("XYZ");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "true"));
  });

  it("defaults the year to the current year when it has loaded data", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([holiday({ loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByLabelText("Year")).toBeInTheDocument());
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR));
  });

  it("falls back to the nearest loaded year, preferring the future on a tie", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "past", loadedForYear: CURRENT_YEAR - 1 }),
      holiday({ publicHolidayId: "future", loadedForYear: CURRENT_YEAR + 1 }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByLabelText("Year")).toBeInTheDocument());
    // Current year absent, past and future both equidistant — future wins.
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR + 1));
  });

  it("REGRESSION: scopes the default year to the resolved jurisdiction, not the whole dataset", async () => {
    // Org defaults to VIC. NSW has the current year loaded; VIC only has an
    // older year. The default must land on VIC + that older year (has data),
    // not VIC + current year (empty) just because SOME jurisdiction has it.
    stubOrgFetch("VIC");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "nsw-current", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR }),
      holiday({ publicHolidayId: "vic-old", jurisdiction: "VIC", loadedForYear: CURRENT_YEAR - 2, holidayName: "VIC Old Day" }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "VIC" })).toHaveAttribute("aria-selected", "true"));
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR - 2));
    expect(screen.getByText("VIC Old Day")).toBeInTheDocument();
  });

  it("picks the strictly nearer loaded year when distances are not tied", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "near", loadedForYear: CURRENT_YEAR - 1 }),
      holiday({ publicHolidayId: "far", loadedForYear: CURRENT_YEAR + 5 }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByLabelText("Year")).toBeInTheDocument());
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR - 1));
  });

  it("formats the holiday date as a weekday + short-month string", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, holidayDate: `${CURRENT_YEAR}-01-01`, holidayName: "New Year's Day" }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());
    const expected = new Date(`${CURRENT_YEAR}-01-01T00:00:00`).toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("filters by jurisdiction AND year together, sorted date-ascending", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "nsw-dec", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, holidayDate: `${CURRENT_YEAR}-12-25`, holidayName: "Christmas Day" }),
      holiday({ publicHolidayId: "nsw-jan", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, holidayDate: `${CURRENT_YEAR}-01-01`, holidayName: "New Year's Day" }),
      holiday({ publicHolidayId: "vic-jan", jurisdiction: "VIC", loadedForYear: CURRENT_YEAR, holidayDate: `${CURRENT_YEAR}-01-01`, holidayName: "VIC Only Day" }),
      holiday({ publicHolidayId: "nsw-other-year", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR - 1, holidayDate: `${CURRENT_YEAR - 1}-01-01`, holidayName: "Old Year Day" }),
    ]);
    render(<PublicHolidaysTab />);

    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());
    expect(screen.queryByText("VIC Only Day")).not.toBeInTheDocument();
    expect(screen.queryByText("Old Year Day")).not.toBeInTheDocument();

    const rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(within(rows[0]).getByText("New Year's Day")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Christmas Day")).toBeInTheDocument();
  });

  it("switching the jurisdiction pill updates the list instantly", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "nsw1", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, holidayName: "NSW Day" }),
      holiday({ publicHolidayId: "vic1", jurisdiction: "VIC", loadedForYear: CURRENT_YEAR, holidayName: "VIC Day" }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("NSW Day")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "VIC" }));
    expect(screen.getByText("VIC Day")).toBeInTheDocument();
    expect(screen.queryByText("NSW Day")).not.toBeInTheDocument();
  });

  it("REGRESSION: switching the jurisdiction pill rescopes the year to one that has data for the new jurisdiction", async () => {
    // NSW has the current year; VIC only has an older year. Switching to VIC
    // must not carry over NSW's year (which is empty for VIC).
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "nsw-current", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR }),
      holiday({ publicHolidayId: "vic-old", jurisdiction: "VIC", loadedForYear: CURRENT_YEAR - 2, holidayName: "VIC Old Day" }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "true"));
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR));

    fireEvent.click(screen.getByRole("tab", { name: "VIC" }));
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR - 2));
    expect(screen.getByText("VIC Old Day")).toBeInTheDocument();
  });

  it("REGRESSION: the Year select only offers years that have data for the active jurisdiction", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "nsw-current", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR }),
      holiday({ publicHolidayId: "vic-future", jurisdiction: "VIC", loadedForYear: CURRENT_YEAR + 3 }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByLabelText("Year")).toBeInTheDocument());
    expect(within(screen.getByLabelText("Year")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      String(CURRENT_YEAR),
    ]);
  });

  it("switching the year select updates the list instantly", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "this-year", loadedForYear: CURRENT_YEAR, holidayName: "This Year Day" }),
      holiday({ publicHolidayId: "next-year", loadedForYear: CURRENT_YEAR + 1, holidayName: "Next Year Day" }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("This Year Day")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: String(CURRENT_YEAR + 1) } });
    expect(screen.getByText("Next Year Day")).toBeInTheDocument();
    expect(screen.queryByText("This Year Day")).not.toBeInTheDocument();
  });

  it("shows a context-specific empty message when the org has other data but none for this filter", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "VIC" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "VIC" }));
    expect(screen.getByText("No holidays loaded")).toBeInTheDocument();
    expect(screen.getByText(`No holidays loaded for VIC in ${CURRENT_YEAR}.`)).toBeInTheDocument();
  });

  it("suppresses the empty-state block when the Add panel is open on a filtered-empty view", async () => {
    stubOrgFetch("VIC");
    listPublicHolidaysMock.mockResolvedValue([]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    expect(screen.queryByText("No public holidays loaded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opens the Add form defaulted to the active filter's jurisdiction", async () => {
    stubOrgFetch("VIC");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "VIC", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "VIC" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: "QLD" }));
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    expect((screen.getByLabelText("Holiday jurisdiction") as HTMLSelectElement).value).toBe("QLD");
  });

  it("REGRESSION: rejects an add with no date, no name, or a partial-day with no start time", async () => {
    listPublicHolidaysMock.mockResolvedValue([]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("A valid date is required")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Holiday name is required")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "Test Day" } });
    fireEvent.click(screen.getByLabelText(/partial day/i));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("A start time is required for a partial-day holiday")).toBeInTheDocument();
    expect(createPublicHolidayMock).not.toHaveBeenCalled();
  });

  it("shows the inline error and keeps the panel open when the save call fails", async () => {
    listPublicHolidaysMock.mockResolvedValue([]);
    createPublicHolidayMock.mockRejectedValue(new Error("Server rejected it"));
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "Test Day" } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Server rejected it")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument(); // panel still open
  });

  it("CRITICAL: saving a holiday for a different jurisdiction/year than the active filter switches the filter to match, so it's never silently hidden", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    createPublicHolidayMock.mockResolvedValue(
      holiday({
        publicHolidayId: "new-qld",
        jurisdiction: "QLD",
        loadedForYear: CURRENT_YEAR + 1,
        holidayDate: `${CURRENT_YEAR + 1}-08-15`,
        holidayName: "Ekka Day",
      }),
    );
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "NSW" })).toHaveAttribute("aria-selected", "true"));

    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText("Holiday jurisdiction"), { target: { value: "QLD" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: `${CURRENT_YEAR + 1}-08-15` } });
    fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "Ekka Day" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Ekka Day")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "QLD" })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR + 1));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument(); // panel closed
  });

  it("adding a holiday matching the active filter appears immediately", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([]);
    createPublicHolidayMock.mockResolvedValue(holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, holidayName: "Added Day" }));
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: `${CURRENT_YEAR}-06-01` } });
    fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "Added Day" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Added Day")).toBeInTheDocument());
  });

  it("removes a holiday from the filtered view on successful delete", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    deletePublicHolidayMock.mockResolvedValue(undefined);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove new year's day/i }));
    await waitFor(() => expect(screen.queryByText("New Year's Day")).not.toBeInTheDocument());
  });

  it("REGRESSION: re-syncs the Year select after deleting the last holiday for the active year", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "only-2099", jurisdiction: "NSW", loadedForYear: 2099, holidayDate: "2099-01-01" }),
      holiday({ publicHolidayId: "nsw-current", jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, holidayName: "Current Year Day" }),
    ]);
    deletePublicHolidayMock.mockResolvedValue(undefined);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByLabelText("Year")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2099" } });
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove new year's day/i }));
    await waitFor(() => expect(screen.queryByText("New Year's Day")).not.toBeInTheDocument());
    // 2099 no longer has any NSW holiday — the select must not be left
    // pointing at a year with no matching <option>.
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(CURRENT_YEAR));
    expect(screen.getByText("Current Year Day")).toBeInTheDocument();
  });

  it("REGRESSION: a slow delete resolving after the user switches jurisdiction re-syncs against the CURRENT filter, not a stale one", async () => {
    // NSW's only holiday is the one being deleted; VIC has an unrelated
    // holiday in a distinct year. If the post-delete re-sync used a stale
    // closure (the filter as it was when Delete was clicked, i.e. NSW/2099)
    // instead of reading it fresh, it would incorrectly reset activeYear
    // after the user has already moved on to VIC.
    stubOrgFetch("NSW");
    const vicYear = CURRENT_YEAR + 5;
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ publicHolidayId: "nsw-2099", jurisdiction: "NSW", loadedForYear: 2099, holidayDate: "2099-01-01", holidayName: "NSW Day" }),
      holiday({ publicHolidayId: "vic-far", jurisdiction: "VIC", loadedForYear: vicYear, holidayName: "VIC Far Day" }),
    ]);
    let resolveDelete!: () => void;
    deletePublicHolidayMock.mockReturnValue(new Promise<void>((resolve) => (resolveDelete = () => resolve())));
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("NSW Day")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove nsw day/i }));

    // While the delete is still in flight, switch to VIC.
    fireEvent.click(screen.getByRole("tab", { name: "VIC" }));
    expect(screen.getByText("VIC Far Day")).toBeInTheDocument();
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(vicYear));

    resolveDelete();
    await waitFor(() => expect(deletePublicHolidayMock).toHaveBeenCalled());
    // Give the post-await state updates a tick to flush.
    await waitFor(() => expect(screen.getByText("VIC Far Day")).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "VIC" })).toHaveAttribute("aria-selected", "true");
    expect((screen.getByLabelText("Year") as HTMLSelectElement).value).toBe(String(vicYear));
  });

  it("leaves the row in place on a failed delete (pre-existing silent no-op)", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    deletePublicHolidayMock.mockRejectedValue(new Error("network error"));
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /remove new year's day/i }));
    await waitFor(() => expect(deletePublicHolidayMock).toHaveBeenCalled());
    expect(screen.getByText("New Year's Day")).toBeInTheDocument();
  });

  it("Cancel closes the Add panel and resets the form back to the active filter's jurisdiction", async () => {
    stubOrgFetch("VIC");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "VIC", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "VIC" })).toHaveAttribute("aria-selected", "true"));

    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText("Holiday jurisdiction"), { target: { value: "QLD" } });
    fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "Half-typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" })); // triggers a validation error first
    expect(screen.getByText("A valid date is required")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();

    // Reopening shows a clean form defaulted back to the active filter, not
    // the half-typed QLD/"Half-typed" state or the stale validation error.
    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    expect((screen.getByLabelText("Holiday jurisdiction") as HTMLSelectElement).value).toBe("VIC");
    expect((screen.getByLabelText("Holiday name") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText("A valid date is required")).not.toBeInTheDocument();
  });

  it("sends trimmed optional fields as null and includes regionNote/sourceCitation/partialDayFromTime when provided", async () => {
    listPublicHolidaysMock.mockResolvedValue([]);
    createPublicHolidayMock.mockResolvedValue(holiday({ jurisdiction: "VIC", loadedForYear: 2027, holidayName: "Regional Day" }));
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("No public holidays loaded")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add holiday/i }));
    fireEvent.change(screen.getByLabelText("Holiday jurisdiction"), { target: { value: "VIC" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2027-03-11" } });
    fireEvent.change(screen.getByLabelText("Holiday name"), { target: { value: "  Regional Day  " } });
    fireEvent.click(screen.getByLabelText(/^regional/i));
    fireEvent.change(screen.getByLabelText("Region note"), { target: { value: "  Metro Melbourne only  " } });
    fireEvent.click(screen.getByLabelText(/partial day/i));
    fireEvent.change(screen.getByLabelText("Applies from"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createPublicHolidayMock).toHaveBeenCalledTimes(1));
    expect(createPublicHolidayMock).toHaveBeenCalledWith({
      jurisdiction: "VIC",
      holidayDate: "2027-03-11",
      holidayName: "Regional Day",
      isRegional: true,
      regionNote: "Metro Melbourne only",
      sourceCitation: null,
      loadedForYear: 2027,
      partialDayFromTime: "13:00",
    });
  });

  it("renders the Regional and partial-day 'From <time>' badges in the Tags column", async () => {
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([
      holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR, isRegional: true, partialDayFromTime: "19:00" }),
    ]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());

    expect(screen.getByText("Regional")).toBeInTheDocument();
    expect(screen.getByText("From 19:00")).toBeInTheDocument();
  });

  it("hides Add/Delete controls without roster:manage", async () => {
    hasPermissionMock.mockReturnValue(false);
    stubOrgFetch("NSW");
    listPublicHolidaysMock.mockResolvedValue([holiday({ jurisdiction: "NSW", loadedForYear: CURRENT_YEAR })]);
    render(<PublicHolidaysTab />);
    await waitFor(() => expect(screen.getByText("New Year's Day")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: /add holiday/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove new year's day/i })).not.toBeInTheDocument();
  });
});
