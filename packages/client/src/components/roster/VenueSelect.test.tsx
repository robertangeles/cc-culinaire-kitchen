import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let mockLocations: { storeLocationId: string; locationName: string }[] = [
  { storeLocationId: "loc-hq", locationName: "HQ - Almost French Patisserie" },
  { storeLocationId: "loc-branch", locationName: "Branch - Almost French Epicure" },
];

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ locations: mockLocations }),
}));

const { VenueSelect } = await import("./VenueSelect.js");

describe("VenueSelect", () => {
  it("renders 'All venues' plus each org venue", () => {
    render(<VenueSelect value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "All venues" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "HQ - Almost French Patisserie" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Branch - Almost French Epicure" })).toBeInTheDocument();
  });

  it("calls onChange with the venue id when a specific venue is picked", () => {
    const onChange = vi.fn();
    render(<VenueSelect value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "loc-hq" } });
    expect(onChange).toHaveBeenCalledWith("loc-hq");
  });

  it("calls onChange with null when 'All venues' is picked", () => {
    const onChange = vi.fn();
    render(<VenueSelect value="loc-hq" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("still renders 'All venues' only when the org has zero venues", () => {
    mockLocations = [];
    render(<VenueSelect value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "All venues" })).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    mockLocations = [
      { storeLocationId: "loc-hq", locationName: "HQ - Almost French Patisserie" },
      { storeLocationId: "loc-branch", locationName: "Branch - Almost French Epicure" },
    ];
  });
});
