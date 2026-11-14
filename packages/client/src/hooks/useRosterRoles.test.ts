import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRosterRoles, useOrgMembers, parseError, getRoleDocuments, listPublicHolidays } from "./useRoster.js";

const res = (ok: boolean, body: unknown) => ({ ok, json: async () => body }) as unknown as Response;
const mockFetch = (impl: (url: string, init?: RequestInit) => Promise<unknown>) => {
  const fn = vi.fn(impl);
  global.fetch = fn as unknown as typeof fetch;
  return fn;
};

const sampleRole = {
  rosterRoleId: "r1",
  organisationId: 1,
  storeLocationId: null,
  roleName: "Bartender",
  createdDttm: "2026-09-07T00:00:00Z",
  updatedDttm: "2026-09-07T00:00:00Z",
};

describe("parseError", () => {
  it("uses the server's string error message", async () => {
    expect((await parseError(res(false, { error: "Nope" }), "fallback")).message).toBe("Nope");
  });

  it.each([
    ["an object", { error: { code: 1 } }],
    ["an array", { error: ["a"] }],
    ["a number", { error: 42 }],
    ["null", { error: null }],
    ["missing", {}],
  ])("falls back when error is %s (no '[object Object]' leaking to the UI)", async (_label, body) => {
    expect((await parseError(res(false, body), "fallback")).message).toBe("fallback");
  });

  it("falls back when the body is not JSON", async () => {
    const bad = { ok: false, json: async () => { throw new SyntaxError("Unexpected token <"); } } as unknown as Response;
    expect((await parseError(bad, "fallback")).message).toBe("fallback");
  });

  it("attaches blocked and conflicts so callers can render the detail", async () => {
    const blocked = { documentType: "RSA", reason: "expired", expiryDate: "2026-01-01" };
    const conflicts = [{ storeLocationId: "loc1", locationName: "CBD" }];
    const err = await parseError(res(false, { error: "Blocked", blocked, conflicts }), "fallback");
    expect(err.blocked).toEqual(blocked);
    expect(err.conflicts).toEqual(conflicts);
  });

  it("leaves blocked and conflicts undefined when the server sent neither", async () => {
    const err = await parseError(res(false, { error: "x" }), "fallback");
    expect(err.blocked).toBeUndefined();
    expect(err.conflicts).toBeUndefined();
  });
});

describe("useRosterRoles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads roles on mount", async () => {
    mockFetch(async () => res(true, [sampleRole]));
    const { result } = renderHook(() => useRosterRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.roles).toEqual([sampleRole]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a server error message instead of throwing", async () => {
    mockFetch(async () => res(false, { error: "Forbidden" }));
    const { result } = renderHook(() => useRosterRoles());
    await waitFor(() => expect(result.current.error).toBe("Forbidden"));
    expect(result.current.roles).toEqual([]);
  });

  it("create() posts, then refreshes and returns the created role", async () => {
    const fetchMock = mockFetch(async (_url, init) =>
      init?.method === "POST" ? res(true, sampleRole) : res(true, [sampleRole]),
    );
    const { result } = renderHook(() => useRosterRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let created;
    await act(async () => {
      created = await result.current.create({ roleName: "Bartender" });
    });

    expect(created).toEqual(sampleRole);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("update() throws the server's conflicts and does not refresh on failure", async () => {
    const conflicts = [{ storeLocationId: "loc1", locationName: "CBD" }];
    const fetchMock = mockFetch(async (_url, init) =>
      init?.method === "PUT" ? res(false, { error: "Venue conflict", conflicts }) : res(true, [sampleRole]),
    );
    const { result } = renderHook(() => useRosterRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.update("r1", { roleName: "Bar" })).rejects.toMatchObject({
        message: "Venue conflict",
        conflicts,
      });
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("remove() DELETEs then refreshes without flipping isLoading back on", async () => {
    mockFetch(async (_url, init) => (init?.method === "DELETE" ? res(true, {}) : res(true, [sampleRole])));
    const { result } = renderHook(() => useRosterRoles());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      const p = result.current.remove("r1");
      expect(result.current.isLoading).toBe(false);
      await p;
    });
  });
});

describe("useOrgMembers", () => {
  afterEach(() => vi.restoreAllMocks());

  const member = { userId: 7, displayName: "Sam", photoPath: null, extra: "dropped" };

  it("loads members, mapping only the picker fields", async () => {
    mockFetch(async () => res(true, { members: [member] }));
    const { result } = renderHook(() => useOrgMembers(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.members).toEqual([{ userId: 7, displayName: "Sam", photoPath: null }]);
    expect(result.current.error).toBeNull();
  });

  it("sets error (not just an empty list) when the network request fails", async () => {
    mockFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { result } = renderHook(() => useOrgMembers(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Failed to fetch");
    expect(result.current.members).toEqual([]);
  });

  it("sets error when the server answers non-OK, so a failure is distinguishable from a venue with no staff", async () => {
    mockFetch(async () => res(false, { error: "Forbidden" }));
    const { result } = renderHook(() => useOrgMembers(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("Forbidden");
    expect(result.current.members).toEqual([]);
  });

  it("clears the error on a later successful fetch", async () => {
    let fail = true;
    mockFetch(async () => (fail ? res(false, { error: "Boom" }) : res(true, { members: [member] })));
    const { result, rerender } = renderHook(({ id }) => useOrgMembers(id), { initialProps: { id: 1 } });
    await waitFor(() => expect(result.current.error).toBe("Boom"));

    fail = false;
    rerender({ id: 2 });
    await waitFor(() => expect(result.current.members).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it("a genuinely empty org is not an error", async () => {
    mockFetch(async () => res(true, { members: [] }));
    const { result } = renderHook(() => useOrgMembers(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.members).toEqual([]);
  });

  it("skips the fetch when there is no org", async () => {
    const fetchMock = mockFetch(async () => res(true, { members: [] }));
    const { result } = renderHook(() => useOrgMembers(null));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});

describe("standalone role/holiday fetchers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("getRoleDocuments returns the document types", async () => {
    mockFetch(async () => res(true, ["RSA", "WWCC"]));
    await expect(getRoleDocuments("r1")).resolves.toEqual(["RSA", "WWCC"]);
  });

  it("getRoleDocuments throws the server message on failure", async () => {
    mockFetch(async () => res(false, { error: "Role not found" }));
    await expect(getRoleDocuments("r1")).rejects.toThrow("Role not found");
  });

  it("listPublicHolidays returns the list", async () => {
    mockFetch(async () => res(true, [{ publicHolidayId: "h1" }]));
    await expect(listPublicHolidays()).resolves.toEqual([{ publicHolidayId: "h1" }]);
  });

  it("listPublicHolidays throws the fallback when the error body is malformed", async () => {
    mockFetch(async () => res(false, { error: { nested: true } }));
    await expect(listPublicHolidays()).rejects.toThrow("Failed to load public holidays");
  });
});
