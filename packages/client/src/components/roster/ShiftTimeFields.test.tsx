import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShiftTimeFields } from "./ShiftsManager.js";

/**
 * The branching logic that decides whether a shift's duration needs a
 * confirm before Create/Save — this is what would have caught the
 * 129h/157h roster-incident shifts at entry time.
 */

function renderFields(start: string, end: string, confirmed = false, onConfirmedChange = vi.fn()) {
  return render(
    <ShiftTimeFields
      startDatetime={start}
      endDatetime={end}
      onStartChange={vi.fn()}
      onEndChange={vi.fn()}
      confirmed={confirmed}
      onConfirmedChange={onConfirmedChange}
    />,
  );
}

describe("ShiftTimeFields", () => {
  it("shows no warning for a normal same-day shift", () => {
    renderFields("2026-09-07T08:00", "2026-09-07T17:00");
    expect(screen.getByText(/^Duration: 9h$/)).toBeInTheDocument();
    expect(screen.queryByText(/unusually long/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/I confirm this is correct/)).not.toBeInTheDocument();
  });

  it("warns above the 16-hour threshold", () => {
    renderFields("2026-09-07T08:00", "2026-09-08T01:00");
    expect(screen.getByText(/unusually long/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I confirm this is correct/)).toBeInTheDocument();
  });

  it("does not warn for a normal overnight shift crossing exactly one midnight", () => {
    renderFields("2026-09-07T22:00", "2026-09-08T06:00");
    expect(screen.queryByText(/unusually long/)).not.toBeInTheDocument();
  });

  it("warns when the shift spans more than one day apart, even under 16 raw hours would not apply here — this case is 157h so both trigger", () => {
    // The actual roster-incident shift: Mon 7 Sept 8am -> Sun 13 Sept 9pm.
    renderFields("2026-09-07T08:00", "2026-09-13T21:00");
    expect(screen.getByText(/unusually long/)).toBeInTheDocument();
    expect(screen.getByLabelText(/I confirm this is correct/)).toBeInTheDocument();
  });

  it("calls onConfirmedChange when the confirm checkbox is toggled", () => {
    const onConfirmedChange = vi.fn();
    renderFields("2026-09-07T08:00", "2026-09-08T01:00", false, onConfirmedChange);
    fireEvent.click(screen.getByLabelText(/I confirm this is correct/));
    expect(onConfirmedChange).toHaveBeenCalledWith(true);
  });

  it("regression: re-arms the confirm gate when a field changes after being confirmed", () => {
    // A confirmed 17h shift edited to span 6 days must not stay confirmed —
    // this is the exact class of bad data (129h/157h) the gate exists to catch.
    const onConfirmedChange = vi.fn();
    renderFields("2026-09-07T08:00", "2026-09-08T01:00", true, onConfirmedChange);
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "2026-09-13T21:00" } });
    expect(onConfirmedChange).toHaveBeenCalledWith(false);
  });

  it("regression: re-arms the confirm gate when the start field changes after being confirmed", () => {
    const onConfirmedChange = vi.fn();
    renderFields("2026-09-07T08:00", "2026-09-08T01:00", true, onConfirmedChange);
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2026-09-01T08:00" } });
    expect(onConfirmedChange).toHaveBeenCalledWith(false);
  });

  it("shows minutes alongside hours for a fractional-hour shift", () => {
    renderFields("2026-09-07T08:00", "2026-09-07T16:30");
    expect(screen.getByText(/^Duration: 8h 30m$/)).toBeInTheDocument();
  });

  it("renders no duration or warning until both start and end are set", () => {
    renderFields("", "");
    expect(screen.queryByText(/^Duration:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/unusually long/)).not.toBeInTheDocument();
  });
});
