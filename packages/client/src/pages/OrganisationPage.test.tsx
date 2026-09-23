import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Tabs are now permission-filtered (User Management / Organisation Settings
 * need org:manage-organisation, Team Compliance needs compliance:read-all
 * or compliance:verify — a Paid Subscriber holds the latter without the
 * former). That's new branching this page didn't have before Team
 * Compliance moved in, so it gets the same defence CompliancePage's own
 * tests were built around: `user` starts null while AuthContext is still
 * resolving, so a tab list seeded once via useState would freeze on "no
 * tabs" for 100% of users, Administrators included.
 */

const mockUseAuth = vi.fn();
vi.mock("../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("../components/organisation/TeamMembersSection.js", () => ({
  TeamMembersSection: () => <div>STUB user management</div>,
}));
vi.mock("../components/organisation/OrganisationBrandingForm.js", () => ({
  OrganisationBrandingForm: () => <div>STUB organisation settings</div>,
}));
vi.mock("../components/organisation/TeamComplianceSection.js", () => ({
  TeamComplianceSection: () => <div>STUB team compliance</div>,
}));

const { default: OrganisationPage } = await import("./OrganisationPage.js");

function signedIn(permissions: string[], roles: string[] = ["Subscriber"]) {
  return { user: { userId: 1, permissions, roles }, isGuest: false };
}

const org = { organisationId: 1, organisationName: "Test Org", organisationLogoPath: null, organisationColorAccent: null, defaultTimezone: "Australia/Melbourne", defaultCurrency: "AUD", defaultJurisdiction: null };

describe("OrganisationPage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUseAuth.mockReset();
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ organisation: org }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => vi.restoreAllMocks());

  it("still picks a visible tab when auth resolves after the first render", async () => {
    mockUseAuth.mockReturnValue({ user: null, isGuest: false });
    const view = render(<OrganisationPage />);
    await waitFor(() => expect(screen.queryByText("Test Org")).toBeInTheDocument());
    expect(screen.queryByText("STUB user management")).not.toBeInTheDocument();

    mockUseAuth.mockReturnValue(signedIn(["org:manage-organisation"]));
    view.rerender(<OrganisationPage />);

    await waitFor(() => expect(screen.getByText("STUB user management")).toBeInTheDocument());
  });

  it("a compliance-only user (no org:manage-organisation) sees only Team Compliance", async () => {
    mockUseAuth.mockReturnValue(signedIn(["compliance:read-all"]));
    render(<OrganisationPage />);

    await waitFor(() => expect(screen.getByText("STUB team compliance")).toBeInTheDocument());
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    expect(screen.queryByText("STUB user management")).not.toBeInTheDocument();
  });

  it("an org:manage-organisation-only user (no compliance permission) never sees Team Compliance", async () => {
    mockUseAuth.mockReturnValue(signedIn(["org:manage-organisation"]));
    render(<OrganisationPage />);

    await waitFor(() => expect(screen.getByText("STUB user management")).toBeInTheDocument());
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.queryByText("STUB team compliance")).not.toBeInTheDocument();
  });

  it("an Administrator sees all three tabs", async () => {
    mockUseAuth.mockReturnValue(signedIn([], ["Administrator"]));
    render(<OrganisationPage />);

    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(3));
  });
});
