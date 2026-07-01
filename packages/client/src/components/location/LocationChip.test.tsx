import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocationChip } from "./LocationChip.js";
import { OPEN_LOCATION_SWITCHER_EVENT } from "./LocationSwitcher.js";

const useLocationMock = vi.fn();
vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => useLocationMock(),
}));

function loc(id: string, name: string) {
  return { storeLocationId: id, locationName: name, organisationId: 1, classification: "branch", colorAccent: null, photoPath: null };
}

beforeEach(() => useLocationMock.mockReset());

describe("LocationChip", () => {
  it("renders nothing when the user has no location access", () => {
    useLocationMock.mockReturnValue({ hasLocationAccess: false, locations: [], selectedLocation: null });
    const { container } = render(<LocationChip />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a static chip (no button) for a single-location user", () => {
    useLocationMock.mockReturnValue({
      hasLocationAccess: true,
      locations: [loc("a", "Main Kitchen")],
      selectedLocation: loc("a", "Main Kitchen"),
    });
    render(<LocationChip />);
    expect(screen.getByText("Main Kitchen")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a switch button for multi-location users and opens the switcher on click", () => {
    useLocationMock.mockReturnValue({
      hasLocationAccess: true,
      locations: [loc("a", "Main Kitchen"), loc("b", "Downtown")],
      selectedLocation: loc("b", "Downtown"),
    });
    const listener = vi.fn();
    window.addEventListener(OPEN_LOCATION_SWITCHER_EVENT, listener);
    render(<LocationChip />);
    const btn = screen.getByRole("button");
    expect(screen.getByText("Downtown")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(OPEN_LOCATION_SWITCHER_EVENT, listener);
  });
});
