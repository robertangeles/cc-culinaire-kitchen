import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Set PII encryption keys before imports
const TEST_PII_KEY = crypto.randomBytes(32).toString("hex");
const TEST_HMAC_KEY = crypto.randomBytes(32).toString("hex");
process.env.PII_ENCRYPTION_KEY = TEST_PII_KEY;
process.env.PII_HMAC_KEY = TEST_HMAC_KEY;

// ── Mock DB ───────────────────────────────────────────────────────────
let mockSelectRows: any[] = [];
const mockInsertReturning = vi.fn(() => [{ storeLocationId: "uuid-1", storeKey: "KITCHEN-ABC123" }]);
const mockDeleteReturning = vi.fn(() => [{ userStoreLocationId: "del-1" }]);
const mockUpdateReturning = vi.fn(() => [{ storeLocationId: "uuid-1" }]);

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockSelectRows),
        innerJoin: vi.fn(() => ({
          where: vi.fn(() => mockSelectRows),
        })),
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => mockSelectRows),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockInsertReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: mockUpdateReturning,
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: mockDeleteReturning,
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  storeLocation: {
    storeLocationId: "store_location_id",
    organisationId: "organisation_id",
    locationName: "location_name",
    classification: "classification",
    storeKey: "store_key",
    isActiveInd: "is_active_ind",
    colorAccent: "color_accent",
    photoPath: "photo_path",
    createdBy: "created_by",
    addressLine1: "address_line_1",
    addressLine2: "address_line_2",
    suburb: "suburb",
    state: "state",
    country: "country",
    postcode: "postcode",
    locationNameEnc: "location_name_enc",
    locationNameIv: "location_name_iv",
    locationNameTag: "location_name_tag",
    locationAddressEnc: "location_address_enc",
    locationAddressIv: "location_address_iv",
    locationAddressTag: "location_address_tag",
    createdDttm: "created_dttm",
    updatedDttm: "updated_dttm",
  },
  userStoreLocation: {
    userStoreLocationId: "user_store_location_id",
    userId: "user_id",
    storeLocationId: "store_location_id",
    assignedBy: "assigned_by",
    assignedAtDttm: "assigned_at_dttm",
  },
  userOrganisation: {
    userId: "user_id",
    organisationId: "organisation_id",
    role: "role",
  },
  user: {
    userId: "user_id",
    userName: "user_name",
    userPhotoPath: "user_photo_path",
    userBio: "user_bio",
    userEmail: "user_email",
    userNameEnc: "user_name_enc",
    userNameIv: "user_name_iv",
    userNameTag: "user_name_tag",
    userEmailEnc: "user_email_enc",
    userEmailIv: "user_email_iv",
    userEmailTag: "user_email_tag",
    userBioEnc: "user_bio_enc",
    userBioIv: "user_bio_iv",
    userBioTag: "user_bio_tag",
    selectedLocationId: "selected_location_id",
  },
  storeLocationHour: {
    storeLocationHourId: "store_location_hour_id",
    storeLocationId: "store_location_id",
    dayOfWeek: "day_of_week",
    openTime: "open_time",
    closeTime: "close_time",
    isClosedInd: "is_closed_ind",
  },
  organisation: { organisationId: "organisation_id" },
  wasteLog: { storeLocationId: "store_location_id", loggedAt: "logged_at" },
  prepSession: { storeLocationId: "store_location_id", createdDttm: "created_dttm" },
}));

vi.mock("./piiService.js", () => ({
  decryptUserPii: (row: Record<string, unknown>) => ({
    userName: row.userName ?? "Test User",
    userEmail: row.userEmail ?? "test@test.com",
    userBio: null,
  }),
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe("storeLocationService", () => {
  beforeEach(() => {
    mockSelectRows = [];
    vi.clearAllMocks();
  });

  describe("joinStoreLocation", () => {
    it("throws when store key not found", async () => {
      mockSelectRows = [];
      const { joinStoreLocation } = await import("./storeLocationService.js");
      await expect(joinStoreLocation(1, "KITCHEN-INVALID")).rejects.toThrow("Store key not found");
    });

    it("throws when location is inactive", async () => {
      // First call returns location, but inactive
      const originalSelect = (await import("../db/index.js")).db.select;
      let callCount = 0;
      (originalSelect as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => {
            callCount++;
            if (callCount === 1) return [{ storeLocationId: "uuid-1", organisationId: 1, isActiveInd: false, storeKey: "KITCHEN-ABC" }];
            return [];
          }),
        })),
      }));

      const { joinStoreLocation } = await import("./storeLocationService.js");
      await expect(joinStoreLocation(1, "KITCHEN-ABC")).rejects.toThrow("no longer active");
    });
  });

  describe("hasLocationAccess", () => {
    it("returns true when user is directly assigned", async () => {
      const dbModule = await import("../db/index.js");
      (dbModule.db.select as any).mockImplementation(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => [{ userStoreLocationId: "asg-1" }]),
        })),
      }));

      const { hasLocationAccess } = await import("./storeLocationService.js");
      const result = await hasLocationAccess(1, "uuid-1");
      expect(result).toBe(true);
    });
  });
});
