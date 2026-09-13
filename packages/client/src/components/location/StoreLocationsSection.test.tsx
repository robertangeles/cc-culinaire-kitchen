import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * "Copy roles from an existing venue" — inline in the create-location form
 * (docs/designs/roster-roles-venue-picker.md). Covers: venue-scoped roles
 * only (org-wide excluded), duplicate-name skip, partial-failure retry, the
 * field hidden at zero existing venues, and no refresh() call (this
 * component has no roles list to go stale).
 */

const refreshLocations = vi.fn();

vi.mock("../../context/LocationContext.js", () => ({
  useLocation: () => ({ refreshLocations }),
}));

const { StoreLocationsSection } = await import("./StoreLocationsSection.js");

const EXISTING_LOCATIONS = [
  { storeLocationId: "loc-hq", locationName: "HQ", classification: "hq", storeKey: "k1", isActiveInd: true },
];

const SOURCE_ROLES = [
  { roleName: "Barista", storeLocationId: "loc-hq" },
  { roleName: "Bartender", storeLocationId: "loc-hq" },
  { roleName: "Duty Manager", storeLocationId: null }, // org-wide — must be excluded from the copy
];

function mockFetch(overrides: Record<string, (url: string, init?: RequestInit) => Response | Promise<Response>>) {
  global.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (key.startsWith(pattern)) return handler(url.toString(), init);
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;
}

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("StoreLocationsSection — copy roles from an existing venue", () => {
  beforeEach(() => {
    refreshLocations.mockReset();
  });

  it("hides the copy-roles field when the org has zero existing venues", async () => {
    mockFetch({
      "GET /api/store-locations/mine": () => jsonRes({ locations: [] }),
    });
    render(<StoreLocationsSection orgId={1} />);

    fireEvent.click(await screen.findByText("Add Location"));
    expect(screen.queryByText(/Copy roles from an existing venue/)).not.toBeInTheDocument();
  });

  it("copies only venue-scoped roles (org-wide excluded) and skips a duplicate", async () => {
    let copyCalls: string[] = [];
    mockFetch({
      "GET /api/store-locations/mine": () => jsonRes({ locations: EXISTING_LOCATIONS }),
      "GET /api/roster/roles": () => jsonRes(SOURCE_ROLES),
      "POST /api/store-locations": () => jsonRes({ storeLocation: { storeLocationId: "loc-new" } }, 201),
      "POST /api/roster/roles": (_url, init) => {
        const body = JSON.parse(init!.body as string);
        copyCalls.push(body.roleName);
        if (body.roleName === "Bartender") return jsonRes({ error: "duplicate" }, 409);
        return jsonRes({ rosterRoleId: "new-role", roleName: body.roleName }, 201);
      },
    });

    render(<StoreLocationsSection orgId={1} />);
    fireEvent.click(await screen.findByText("Add Location"));

    fireEvent.change(screen.getByPlaceholderText("e.g. Main Kitchen"), { target: { value: "Branch 2" } });
    fireEvent.change(screen.getByDisplayValue("Don't copy roles"), { target: { value: "loc-hq" } });
    fireEvent.click(screen.getByText("Create Location"));

    await waitFor(() => expect(screen.getByText(/Copied 1 role, skipped 1/)).toBeInTheDocument());

    // Org-wide "Duty Manager" was never sent as a copy target.
    expect(copyCalls).not.toContain("Duty Manager");
    expect(copyCalls.sort()).toEqual(["Barista", "Bartender"]);
  });

  it("shows a retry action on partial failure, and retrying only resubmits the failed subset", async () => {
    let attempt = 0;
    mockFetch({
      "GET /api/store-locations/mine": () => jsonRes({ locations: EXISTING_LOCATIONS }),
      "GET /api/roster/roles": () => jsonRes(SOURCE_ROLES),
      "POST /api/store-locations": () => jsonRes({ storeLocation: { storeLocationId: "loc-new" } }, 201),
      "POST /api/roster/roles": (_url, init) => {
        const body = JSON.parse(init!.body as string);
        if (body.roleName === "Barista" && attempt === 0) {
          attempt++;
          return jsonRes({ error: "network blip" }, 500);
        }
        return jsonRes({ rosterRoleId: "new-role", roleName: body.roleName }, 201);
      },
    });

    render(<StoreLocationsSection orgId={1} />);
    fireEvent.click(await screen.findByText("Add Location"));
    fireEvent.change(screen.getByPlaceholderText("e.g. Main Kitchen"), { target: { value: "Branch 2" } });
    fireEvent.change(screen.getByDisplayValue("Don't copy roles"), { target: { value: "loc-hq" } });
    fireEvent.click(screen.getByText("Create Location"));

    await waitFor(() => expect(screen.getByText(/1 failed/)).toBeInTheDocument());
    fireEvent.click(screen.getByText("Retry failed"));

    await waitFor(() => expect(screen.getByText(/Copied 2 roles/)).toBeInTheDocument());
    expect(screen.queryByText("Retry failed")).not.toBeInTheDocument();
  });
});
