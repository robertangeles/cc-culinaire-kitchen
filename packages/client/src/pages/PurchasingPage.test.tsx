import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * Wave 5 on the web: the Approvals tab follows `purchasing:approve` (not the organisation-admin role), Settings needs
 * both (the server lets only organisation admins change thresholds), and an approver's own waiting order shows why it
 * cannot be approved instead of an Approve button the server would refuse.
 */

let mockUser: { permissions: string[]; roles: string[] } = { permissions: [], roles: [] };
let mockIsOrgAdmin = false;
let mockPos: Array<Record<string, unknown>> = [];

vi.mock("../context/AuthContext.js", () => ({
  useAuth: () => ({ user: mockUser, isGuest: false }),
}));
vi.mock("../context/LocationContext.js", () => ({
  useLocation: () => ({ selectedLocationId: "loc-1", isOrgAdmin: mockIsOrgAdmin }),
}));
vi.mock("../context/GuideContext.js", () => ({
  useGuide: () => ({ setGuideKeyOverride: vi.fn() }),
}));
vi.mock("../hooks/useInventory.js", () => ({
  usePurchaseOrders: () => ({ pos: mockPos, isLoading: false, refresh: vi.fn(), approvePO: vi.fn(), rejectPO: vi.fn() }),
}));
vi.mock("../components/inventory/PurchaseOrderList.js", () => ({ default: () => null }));
vi.mock("../components/inventory/SupplierManager.js", () => ({ SupplierManager: () => null }));
vi.mock("../components/purchasing/ReceiveQueue.js", () => ({ default: () => null }));
vi.mock("../components/purchasing/SpendThresholdSettings.js", () => ({ default: () => null }));
vi.mock("../components/purchasing/AutoPoSuggestionsTable.js", () => ({ AutoPoSuggestionsTable: () => null }));
vi.mock("../components/purchasing/OrderGuideManager.js", () => ({ default: () => null }));

const { PurchasingPage } = await import("./PurchasingPage.js");

const renderAt = (url = "/purchasing") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <PurchasingPage />
    </MemoryRouter>,
  );

const pending = (poId: string, canApprove?: boolean) => ({
  poId,
  poNumber: `PO-${poId}`,
  status: "PENDING_APPROVAL",
  submittedAt: new Date().toISOString(),
  supplierName: "PFD",
  locationName: "HQ",
  lineCount: 1,
  totalValue: "120",
  createdByUserName: "Sam",
  ...(canApprove === undefined ? {} : { canApprove }),
});

describe("PurchasingPage tabs", () => {
  beforeEach(() => {
    mockUser = { permissions: [], roles: [] };
    mockIsOrgAdmin = false;
    mockPos = [];
  });

  it("shows Approvals to a purchasing:approve holder who is not an organisation admin, without Settings", () => {
    mockUser.permissions = ["purchasing:approve"];
    renderAt();
    expect(screen.getByRole("tab", { name: /Approvals/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Settings/ })).toBeNull();
  });

  it("hides Approvals and Settings from an organisation admin without purchasing:approve", () => {
    mockIsOrgAdmin = true;
    renderAt();
    expect(screen.queryByRole("tab", { name: /Approvals/ })).toBeNull();
    expect(screen.queryByRole("tab", { name: /Settings/ })).toBeNull();
  });

  it("shows Settings to an organisation admin who can approve", () => {
    mockIsOrgAdmin = true;
    mockUser.permissions = ["purchasing:approve"];
    renderAt();
    expect(screen.getByRole("tab", { name: /Settings/ })).toBeTruthy();
  });

  it("replaces Approve on the approver's own order with the reason, and keeps it on others", async () => {
    mockUser.permissions = ["purchasing:approve"];
    mockPos = [pending("own", false), pending("other", true), pending("older-server")];
    renderAt("/purchasing?tab=approvals");
    expect(await screen.findByText("Another approver must approve your order")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Approve$/ })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: /^Reject$/ })).toHaveLength(3);
  });
});
