import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB ───────────────────────────────────────────────────────────
let mockSelectRows: any[] = [];

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Object.assign([...mockSelectRows], { orderBy: () => mockSelectRows })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => mockSelectRows),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  user: { userId: "user_id", selectedLocationId: "selected_location_id" },
  userOrganisation: { userOrganisationId: "user_organisation_id", userId: "user_id", organisationId: "organisation_id", role: "role" },
  userStoreLocation: { userId: "user_id", storeLocationId: "store_location_id" },
  userLocationPreference: { userId: "user_id", moduleKey: "module_key", storeLocationId: "store_location_id", updatedDttm: "updated_dttm" },
  storeLocation: {
    storeLocationId: "store_location_id",
    organisationId: "organisation_id",
    locationName: "location_name",
    classification: "classification",
    colorAccent: "color_accent",
    photoPath: "photo_path",
    isActiveInd: "is_active_ind",
    addressLine1: "address_line_1",
    locationNameEnc: "location_name_enc",
    locationNameIv: "location_name_iv",
    locationNameTag: "location_name_tag",
    locationAddressEnc: "location_address_enc",
    locationAddressIv: "location_address_iv",
    locationAddressTag: "location_address_tag",
    storeKey: "store_key",
    createdBy: "created_by",
    createdDttm: "created_dttm",
    updatedDttm: "updated_dttm",
  },
}));

vi.mock("./storeLocationService.js", () => ({
  getUserStoreLocations: vi.fn(() => []),
  getOrgStoreLocations: vi.fn(() => []),
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("locationContextService", () => {
  beforeEach(() => {
    mockSelectRows = [];
    vi.clearAllMocks();
  });

  describe("getUserLocationContext", () => {
    it("returns empty context when user has no org", async () => {
      mockSelectRows = [];
      const { getUserLocationContext } = await import("./locationContextService.js");
      const ctx = await getUserLocationContext(999);
      expect(ctx.locations).toEqual([]);
      expect(ctx.isOrgAdmin).toBe(false);
      expect(ctx.hasLocationAccess).toBe(false);
      expect(ctx.selectedLocationId).toBeNull();
    });

    it("returns hasLocationAccess true for admin even with no locations", async () => {
      // Mock: user is org admin with 0 locations
      const dbModule = await import("../db/index.js");
      let callCount = 0;
      (dbModule.db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            callCount++;
            // First call: memberships
            if (callCount === 1) return Object.assign([{ organisationId: 1, role: "admin" }], { orderBy: () => [{ organisationId: 1, role: "admin" }] });
            // Second call: selected location
            return [{ selectedLocationId: null }];
          }),
          innerJoin: vi.fn(() => ({
            where: vi.fn(() => []),
          })),
        })),
      }));

      const { getUserLocationContext } = await import("./locationContextService.js");
      const ctx = await getUserLocationContext(1);
      expect(ctx.isOrgAdmin).toBe(true);
      expect(ctx.hasLocationAccess).toBe(true);
    });
  });

  describe("getUserLocationContext with several memberships", () => {
    const stubDb = async (memberships: Array<{ organisationId: number; role: string }>) => {
      const dbModule = await import("../db/index.js");
      let callCount = 0;
      (dbModule.db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            callCount++;
            if (callCount === 1) return Object.assign([...memberships], { orderBy: () => memberships });
            return [{ selectedLocationId: null }];
          }),
        })),
      }));
    };

    it("is not an org admin of the primary org just because it admins another one", async () => {
      // Primary (first) membership: org 1 as a plain member. Second: admin of org 2.
      await stubDb([
        { organisationId: 1, role: "member" },
        { organisationId: 2, role: "admin" },
      ]);
      const storeLocations = await import("./storeLocationService.js");
      (storeLocations.getOrgStoreLocations as any).mockResolvedValue([
        { storeLocationId: "org1-loc", organisationId: 1, locationName: "A", classification: "kitchen", colorAccent: null, photoPath: null },
      ]);
      (storeLocations.getUserStoreLocations as any).mockResolvedValue([]);

      const { getUserLocationContext } = await import("./locationContextService.js");
      const ctx = await getUserLocationContext(1);

      expect(ctx.organisationId).toBe(1);
      expect(ctx.isOrgAdmin).toBe(false);
      expect(ctx.locations).toEqual([]);
      expect(storeLocations.getOrgStoreLocations).not.toHaveBeenCalled();
    });

    it("only offers assigned locations that belong to the primary org", async () => {
      await stubDb([
        { organisationId: 1, role: "member" },
        { organisationId: 2, role: "member" },
      ]);
      const storeLocations = await import("./storeLocationService.js");
      (storeLocations.getUserStoreLocations as any).mockResolvedValue([
        { storeLocationId: "org1-loc", organisationId: 1, locationName: "A", classification: "kitchen", colorAccent: null, photoPath: null },
        { storeLocationId: "org2-loc", organisationId: 2, locationName: "B", classification: "kitchen", colorAccent: null, photoPath: null },
      ]);

      const { getUserLocationContext } = await import("./locationContextService.js");
      const ctx = await getUserLocationContext(1);

      expect(ctx.locations.map((l) => l.storeLocationId)).toEqual(["org1-loc"]);
    });
  });

  describe("resolveSelectedLocation", () => {
    it("returns null when no preference and no global selection", async () => {
      const dbModule = await import("../db/index.js");
      (dbModule.db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => []),
        })),
      }));

      const { resolveSelectedLocation } = await import("./locationContextService.js");
      const result = await resolveSelectedLocation(1, "waste-intelligence");
      expect(result).toBeNull();
    });

    it("returns module-specific preference when set", async () => {
      const dbModule = await import("../db/index.js");
      (dbModule.db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => [{ storeLocationId: "loc-1" }]),
        })),
      }));

      const { resolveSelectedLocation } = await import("./locationContextService.js");
      const result = await resolveSelectedLocation(1, "waste-intelligence");
      expect(result).toBe("loc-1");
    });
  });
});
