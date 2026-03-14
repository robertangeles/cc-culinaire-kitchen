import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";

// Set encryption key before any imports
const TEST_KEY = crypto.randomBytes(32).toString("hex");
process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;

// Mock DB
const mockRows: any[] = [];
const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn(() => ({ where: vi.fn() }));
const mockDeleteWhere = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => mockRows),
      })),
    })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
    delete: vi.fn(() => ({ where: mockDeleteWhere })),
  },
}));

vi.mock("../db/schema.js", () => ({
  credential: {
    credentialId: "credential_id",
    credentialKey: "credential_key",
    credentialValue: "credential_value",
    credentialIv: "credential_iv",
    credentialTag: "credential_tag",
    credentialCategory: "credential_category",
    keyVersion: "key_version",
    updatedBy: "updated_by",
    createdDttm: "created_dttm",
    updatedDttm: "updated_dttm",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
}));

describe("credentialService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRows.length = 0;
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
  });

  it("CREDENTIAL_REGISTRY has all expected categories", async () => {
    const { CREDENTIAL_REGISTRY } = await import("./credentialService.js");
    const categories = new Set(Object.values(CREDENTIAL_REGISTRY).map((m) => m.category));
    expect(categories).toContain("oauth");
    expect(categories).toContain("ai");
    expect(categories).toContain("email");
    expect(categories).toContain("payments");
    expect(categories).toContain("security");
  });

  it("CREDENTIAL_REGISTRY marks secrets as sensitive", async () => {
    const { CREDENTIAL_REGISTRY } = await import("./credentialService.js");
    expect(CREDENTIAL_REGISTRY.GOOGLE_CLIENT_SECRET.sensitive).toBe(true);
    expect(CREDENTIAL_REGISTRY.GOOGLE_CLIENT_ID.sensitive).toBe(false);
    expect(CREDENTIAL_REGISTRY.ANTHROPIC_API_KEY.sensitive).toBe(true);
    expect(CREDENTIAL_REGISTRY.AI_PROVIDER.sensitive).toBe(false);
  });

  it("maskSecret works correctly via crypto util", async () => {
    const { maskSecret } = await import("../utils/crypto.js");
    expect(maskSecret("sk-ant-secret-1234")).toBe("••••1234");
    expect(maskSecret("ab")).toBe("••••");
  });

  it("encrypt and decrypt roundtrip via crypto util", async () => {
    const { encrypt, decrypt } = await import("../utils/crypto.js");
    const plain = "my-super-secret-api-key";
    const { ciphertext, iv, authTag } = encrypt(plain);
    expect(decrypt(ciphertext, iv, authTag)).toBe(plain);
  });

  it("hydrateEnvFromCredentials is silent when DB unavailable", async () => {
    // Reset modules to get fresh import
    vi.resetModules();

    // Re-mock with throwing DB
    vi.doMock("../db/index.js", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => { throw new Error("DB not available"); }),
        })),
      },
    }));

    vi.doMock("../db/schema.js", () => ({
      credential: {},
    }));

    vi.doMock("drizzle-orm", () => ({
      eq: vi.fn(),
    }));

    const { hydrateEnvFromCredentials } = await import("./credentialService.js");
    // Should not throw
    await expect(hydrateEnvFromCredentials()).resolves.toBeUndefined();
  });
});
