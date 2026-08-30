import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { TeamMembersSection } from "./TeamMembersSection.js";

/**
 * isOrgAdmin here is derived from `members` (the per-org "admin" role on
 * the fetched member list), deliberately mirroring the server's
 * isOrgManager() — never the global org:manage-organisation permission,
 * which isn't scoped to a single org. Promote/remove must stay hidden for
 * a plain member and for the admin's own row (no self-service demotion).
 */

const admin = { userId: 1, displayName: "Alex Admin", photoPath: null, bio: null, role: "admin" as const, joinedAt: "2026-01-01" };
const member = { userId: 2, displayName: "Sam Staff", photoPath: null, bio: null, role: "member" as const, joinedAt: "2026-01-02" };

function mockFetchOnce(...responses: Array<{ ok: boolean; json: () => Promise<unknown> }>) {
  const fetchMock = vi.fn();
  for (const r of responses) fetchMock.mockResolvedValueOnce(r);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("TeamMembersSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading spinner, then the member list", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ members: [admin, member] }) });
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Alex Admin")).toBeInTheDocument());
    expect(screen.getByText("Sam Staff")).toBeInTheDocument();
    expect(screen.getByText("Team Members (2)")).toBeInTheDocument();
  });

  it("shows an error message when the fetch fails", async () => {
    mockFetchOnce({ ok: false, json: async () => ({}) });
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Failed to load members")).toBeInTheDocument());
  });

  it("shows an empty state when the org has no members", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ members: [] }) });
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("No members found.")).toBeInTheDocument());
  });

  it("a plain member sees no promote/remove controls on anyone, including themself", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ members: [admin, member] }) });
    render(<TeamMembersSection orgId={1} currentUserId={2} />);

    await waitFor(() => expect(screen.getByText("Sam Staff")).toBeInTheDocument());
    expect(screen.queryByText("Make Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Make Member")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });

  it("an org admin sees promote/remove on other members, but not on their own row", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ members: [admin, member] }) });
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Sam Staff")).toBeInTheDocument());
    // Exactly one row (Sam's) gets action buttons — the admin's own row does not.
    expect(screen.getAllByText("Make Admin")).toHaveLength(1);
    expect(screen.getAllByText("Remove")).toHaveLength(1);
  });

  it("promoting a member confirms, PATCHes the role, and refetches", async () => {
    const fetchMock = mockFetchOnce(
      { ok: true, json: async () => ({ members: [admin, member] }) },
      { ok: true, json: async () => ({}) },
      { ok: true, json: async () => ({ members: [admin, { ...member, role: "admin" }] }) },
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Make Admin")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Make Admin"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/organisations/1/members/2",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
      ),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it("declining the confirm dialog sends no request", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({ members: [admin, member] }) });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Make Admin")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Make Admin"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shows the server's error message when a role change fails", async () => {
    mockFetchOnce(
      { ok: true, json: async () => ({ members: [admin, member] }) },
      { ok: false, json: async () => ({ error: "Cannot demote the last admin" }) },
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Make Admin")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Make Admin"));

    await waitFor(() => expect(screen.getByText("Cannot demote the last admin")).toBeInTheDocument());
  });

  it("removing a member confirms, DELETEs, and refetches", async () => {
    const fetchMock = mockFetchOnce(
      { ok: true, json: async () => ({ members: [admin, member] }) },
      { ok: true, json: async () => ({}) },
      { ok: true, json: async () => ({ members: [admin] }) },
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<TeamMembersSection orgId={1} currentUserId={1} />);

    await waitFor(() => expect(screen.getByText("Remove")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/organisations/1/members/2", expect.objectContaining({ method: "DELETE" })),
    );
    await waitFor(() => expect(screen.queryByText("Sam Staff")).not.toBeInTheDocument());
  });
});
