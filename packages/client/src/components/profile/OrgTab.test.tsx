import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseAuth = vi.fn();
vi.mock("../../context/AuthContext.js", () => ({ useAuth: () => mockUseAuth() }));
vi.mock("./MyKitchenTab.js", () => ({ MyKitchenTab: () => <div>STUB kitchen</div> }));
vi.mock("./MfaSection.js", () => ({ MfaSection: () => <div>STUB mfa</div> }));
vi.mock("../location/StoreLocationsSection.js", () => ({
  StoreLocationsSection: () => <div>STUB locations</div>,
}));

const { OrgTab } = await import("./OrgTab.js");

function signedIn(userId = 1) {
  return {
    user: { userId, userName: "Test User", permissions: [], roles: [] },
    refreshUser: vi.fn(),
  };
}

const mockOrg = {
  organisationId: 5,
  organisationName: "Test Org",
  organisationAddressLine1: null,
  organisationAddressLine2: null,
  organisationSuburb: null,
  organisationState: null,
  organisationCountry: null,
  organisationPostcode: null,
  organisationWebsite: null,
  organisationEmail: null,
  organisationPhone: null,
  organisationFacebook: null,
  organisationInstagram: null,
  organisationTiktok: null,
  organisationPinterest: null,
  organisationLinkedin: null,
  joinKey: "TEST-KEY",
  createdBy: 1,
};

function makeFetch(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string) => {
    if (url === "/api/organisations/mine") {
      return { ok: true, json: async () => ({ organisation: null }) };
    }
    const handler = overrides[url as string];
    if (handler) return handler;
    return { ok: true, json: async () => ({}) };
  });
}

describe("OrgTab", () => {
  beforeEach(() => {
    mockUseAuth.mockReset();
    vi.stubGlobal("fetch", makeFetch());
  });

  describe("AuthContext race — null user on mount", () => {
    it("fires org fetch on initial mount even when user is null (auth race)", async () => {
      mockUseAuth.mockReturnValue({ user: null, refreshUser: vi.fn() });
      const fetchSpy = vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: "Unauthorized" }),
      }));
      vi.stubGlobal("fetch", fetchSpy);
      render(<OrgTab />);
      await waitFor(() =>
        expect(fetchSpy).toHaveBeenCalledWith(
          "/api/organisations/mine",
          expect.anything(),
        ),
      );
    });

    it("re-fetches org when userId resolves, then shows org UI", async () => {
      mockUseAuth.mockReturnValue({ user: null, refreshUser: vi.fn() });
      const { rerender } = render(<OrgTab />);

      const fetchSpy = vi.fn(async (url: string) => {
        if (url === "/api/organisations/mine")
          return { ok: true, json: async () => ({ organisation: mockOrg }) };
        if (url.endsWith("/members"))
          return {
            ok: true,
            json: async () => ({
              members: [{ userId: 1, role: "admin", displayName: "Test User" }],
            }),
          };
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchSpy);
      mockUseAuth.mockReturnValue(signedIn());
      rerender(<OrgTab />);

      await waitFor(() =>
        expect(screen.getByText("Test Org")).toBeInTheDocument(),
      );
      expect(screen.getByText("Edit Organisation")).toBeInTheDocument();
    });
  });

  describe("no-org state", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue(signedIn());
      vi.stubGlobal("fetch", makeFetch());
    });

    it("shows Create and Join tabs", async () => {
      render(<OrgTab />);
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: "Create" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Join" })).toBeInTheDocument();
      });
    });

    it("handleCreateOrg — sets org and promotes to admin on success", async () => {
      const fetchSpy = vi.fn(async (url: string) => {
        if (url === "/api/organisations/mine")
          return { ok: true, json: async () => ({ organisation: null }) };
        if (url === "/api/organisations")
          return { ok: true, json: async () => ({ organisation: mockOrg }) };
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchSpy);
      render(<OrgTab />);
      await waitFor(() => screen.getByRole("tab", { name: "Create" }));

      const nameInput = screen.getAllByRole("textbox")[0];
      fireEvent.change(nameInput, { target: { value: "My Kitchen" } });
      fireEvent.submit(nameInput.closest("form")!);

      await waitFor(() =>
        expect(screen.getByText("Test Org")).toBeInTheDocument(),
      );
      expect(screen.getByText("Edit Organisation")).toBeInTheDocument();
    });

    it("handleJoinOrg — shows error message on bad join key", async () => {
      const fetchSpy = vi.fn(async (url: string) => {
        if (url === "/api/organisations/mine")
          return { ok: true, json: async () => ({ organisation: null }) };
        if (url === "/api/organisations/join")
          return { ok: false, json: async () => ({ error: "Invalid join key" }) };
        return { ok: true, json: async () => ({}) };
      });
      vi.stubGlobal("fetch", fetchSpy);
      render(<OrgTab />);
      await waitFor(() => screen.getByRole("tab", { name: "Join" }));

      fireEvent.click(screen.getByRole("tab", { name: "Join" }));
      const input = screen.getByPlaceholderText(
        /enter the join key from your organisation/i,
      );
      fireEvent.change(input, { target: { value: "BAD-KEY" } });
      fireEvent.submit(input.closest("form")!);

      await waitFor(() =>
        expect(screen.getByText("Invalid join key")).toBeInTheDocument(),
      );
    });
  });

  describe("with existing org (admin role)", () => {
    beforeEach(() => {
      mockUseAuth.mockReturnValue(signedIn());
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          if (url === "/api/organisations/mine")
            return { ok: true, json: async () => ({ organisation: mockOrg }) };
          if (url.endsWith("/members"))
            return {
              ok: true,
              json: async () => ({
                members: [{ userId: 1, role: "admin", displayName: "Test User" }],
              }),
            };
          return { ok: true, json: async () => ({}) };
        }),
      );
    });

    it("shows org name and Edit Organisation for admin", async () => {
      render(<OrgTab />);
      await waitFor(() =>
        expect(screen.getByText("Test Org")).toBeInTheDocument(),
      );
      expect(screen.getByText("Edit Organisation")).toBeInTheDocument();
    });

    it("handleLeaveOrg — resets to no-org state after leaving", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, opts?: RequestInit) => {
          if (url === "/api/organisations/mine")
            return { ok: true, json: async () => ({ organisation: mockOrg }) };
          if (url.endsWith("/members"))
            return {
              ok: true,
              json: async () => ({
                members: [{ userId: 1, role: "admin", displayName: "Test User" }],
              }),
            };
          if (url.includes("/leave") && opts?.method === "DELETE")
            return { ok: true, json: async () => ({}) };
          return { ok: true, json: async () => ({}) };
        }),
      );
      render(<OrgTab />);
      await waitFor(() => screen.getByText("Edit Organisation"));

      fireEvent.click(screen.getByRole("button", { name: /Leave Organisation/i }));

      await waitFor(() =>
        expect(screen.getByRole("tab", { name: "Create" })).toBeInTheDocument(),
      );
    });
  });
});
