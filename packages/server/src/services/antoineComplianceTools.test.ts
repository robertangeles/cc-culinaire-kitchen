import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * antoineComplianceTool is the first non-HTTP caller of hasPermission — the
 * whole point of extracting that function was so a caller like this one asks
 * the exact same question the HTTP middleware asks, not a re-implementation
 * that could quietly drift. These tests exercise the real hasPermission
 * (unmocked) against a mocked staff list and a mocked audit log, so a
 * regression in either the real permission logic or this module's own
 * ownership-vs-permission branching fails here.
 */

vi.mock("./authService.js", () => ({
  getUserWithRolesAndPermissions: vi.fn(),
}));

vi.mock("./complianceService.js", () => ({
  listStaffCompliance: vi.fn(),
}));

vi.mock("./auditService.js", () => ({
  log: vi.fn(),
}));

import { getUserWithRolesAndPermissions } from "./authService.js";
import { listStaffCompliance } from "./complianceService.js";
import * as auditService from "./auditService.js";
import { antoineComplianceTool } from "./antoineComplianceTools.js";

const STAFF = [
  {
    userId: 1,
    name: "Alex Charasse",
    role: "Chef",
    documents: [
      { documentType: "RSA", status: "compliant" as const, expiryDate: "2027-01-01" },
      { documentType: "Police Check", status: "na" as const, expiryDate: null },
    ],
  },
  {
    userId: 2,
    name: "Jordan Lee",
    role: "Sous Chef",
    documents: [{ documentType: "RSA", status: "expired" as const, expiryDate: "2025-01-01" }],
  },
];

function caller(overrides: Partial<{ roles: string[]; permissions: string[] }> = {}) {
  return {
    userId: 9,
    userName: "Caller",
    userEmail: "caller@test",
    emailVerified: true,
    mfaEnabled: false,
    userPhotoPath: null,
    freeSessions: 0,
    subscriptionStatus: "active",
    subscriptionTier: "free",
    userStatus: "active",
    roles: overrides.roles ?? [],
    permissions: overrides.permissions ?? [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listStaffCompliance).mockResolvedValue(STAFF as never);
});

describe("antoineComplianceTool", () => {
  it("returns found:false and does NOT log when no staff name matches — refusing to be a name-existence oracle", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(caller() as never);

    const result = await antoineComplianceTool(9, 1, { staffName: "Nobody Here", documentType: "RSA" });

    expect(result).toEqual({ found: false });
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it("denies (and logs the denial) a colleague's record for a caller with only compliance:read-own", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:read-own"] }) as never,
    );

    const result = await antoineComplianceTool(9, 1, { staffName: "Alex", documentType: "RSA" });

    expect(result).toEqual({ error: "forbidden" });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "compliance_document",
        entityId: "1",
        action: "query",
        actorUserId: 9,
        organisationId: 1,
        metadata: expect.objectContaining({ source: "antoine", outcome: "denied", staffUserId: 1 }),
      }),
    );
  });

  it("grants (and logs the grant) a caller with compliance:read-all asking about a colleague", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:read-all"] }) as never,
    );

    const result = await antoineComplianceTool(9, 1, { staffName: "Alex", documentType: "RSA" });

    expect(result).toEqual({
      found: true,
      staff: { userId: 1, name: "Alex Charasse", role: "Chef" },
      doc: { documentType: "RSA", expiryDate: "2027-01-01" },
      status: "compliant",
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ outcome: "granted" }) }),
    );
  });

  it("grants compliance:verify the same as compliance:read-all", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:verify"] }) as never,
    );

    const result = await antoineComplianceTool(9, 1, { staffName: "Jordan", documentType: "RSA" });

    expect(result).toMatchObject({ found: true, status: "expired" });
  });

  it("grants a self-query with only compliance:read-own — ownership, not just permission, authorises it", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:read-own"] }) as never,
    );

    // Caller (userId 9) IS staff row userId 1 in this case.
    const result = await antoineComplianceTool(1, 1, { staffName: "Alex", documentType: "RSA" });

    expect(result).toMatchObject({ found: true });
  });

  it("Administrator bypasses the permission check entirely, per hasPermission's own role short-circuit", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ roles: ["Administrator"], permissions: [] }) as never,
    );

    const result = await antoineComplianceTool(9, 1, { staffName: "Alex", documentType: "RSA" });

    expect(result).toMatchObject({ found: true });
  });

  it("returns found:false for a real staff member and a document type the org doesn't track", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:read-all"] }) as never,
    );

    const result = await antoineComplianceTool(9, 1, {
      staffName: "Alex",
      documentType: "Working with Children Check",
    });

    expect(result).toEqual({ found: false });
  });

  it("returns found:false (not na-as-a-verdict) — the na status IS a real verdict, distinct from not-tracked", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:read-all"] }) as never,
    );

    // Police Check IS in Alex's tracked documents, with status "na" (required but never uploaded).
    const result = await antoineComplianceTool(9, 1, { staffName: "Alex", documentType: "Police Check" });

    expect(result).toEqual({
      found: true,
      staff: { userId: 1, name: "Alex Charasse", role: "Chef" },
      doc: { documentType: "Police Check", expiryDate: null },
      status: "na",
    });
  });

  it("matches a staff name case-insensitively as a substring, mirroring the client staff-table search", async () => {
    vi.mocked(getUserWithRolesAndPermissions).mockResolvedValue(
      caller({ permissions: ["compliance:read-all"] }) as never,
    );

    const result = await antoineComplianceTool(9, 1, { staffName: "  ALEX  ", documentType: "RSA" });

    expect(result).toMatchObject({ found: true, staff: { userId: 1 } });
  });
});
