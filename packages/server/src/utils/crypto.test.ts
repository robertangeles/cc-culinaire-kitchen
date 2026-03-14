import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";

// A valid 32-byte hex key for testing
const TEST_KEY = crypto.randomBytes(32).toString("hex");

describe("crypto utils", () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });

  it("encrypt → decrypt roundtrip returns original plaintext", async () => {
    const { encrypt, decrypt } = await import("./crypto.js");
    const plaintext = "sk-ant-api03-secret-key-value-1234";
    const { ciphertext, iv, authTag } = encrypt(plaintext);
    const result = decrypt(ciphertext, iv, authTag);
    expect(result).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", async () => {
    const { encrypt } = await import("./crypto.js");
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("throws on tampered ciphertext", async () => {
    const { encrypt, decrypt } = await import("./crypto.js");
    const { ciphertext, iv, authTag } = encrypt("secret");
    const tampered = "ff" + ciphertext.slice(2);
    expect(() => decrypt(tampered, iv, authTag)).toThrow();
  });

  it("throws on tampered auth tag", async () => {
    const { encrypt, decrypt } = await import("./crypto.js");
    const { ciphertext, iv, authTag } = encrypt("secret");
    const tampered = "ff" + authTag.slice(2);
    expect(() => decrypt(ciphertext, iv, tampered)).toThrow();
  });

  it("handles empty string", async () => {
    const { encrypt, decrypt } = await import("./crypto.js");
    const { ciphertext, iv, authTag } = encrypt("");
    expect(decrypt(ciphertext, iv, authTag)).toBe("");
  });

  it("handles unicode content", async () => {
    const { encrypt, decrypt } = await import("./crypto.js");
    const plaintext = "クリプト🔑テスト";
    const { ciphertext, iv, authTag } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv, authTag)).toBe(plaintext);
  });

  it("getEncryptionKey throws when env var missing", async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
    const { getEncryptionKey } = await import("./crypto.js");
    expect(() => getEncryptionKey()).toThrow("CREDENTIALS_ENCRYPTION_KEY is not set");
  });

  it("getEncryptionKey throws for invalid hex length", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = "abcd";
    const { getEncryptionKey } = await import("./crypto.js");
    expect(() => getEncryptionKey()).toThrow("64 hex characters");
  });
});

describe("ensureEncryptionKey", () => {
  afterEach(() => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;
  });

  it("generates a valid 64-char hex key when missing", async () => {
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    const { ensureEncryptionKey } = await import("./crypto.js");
    ensureEncryptionKey();

    expect(process.env.CREDENTIALS_ENCRYPTION_KEY).toBeDefined();
    expect(process.env.CREDENTIALS_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not overwrite an existing key", async () => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = TEST_KEY;

    const { ensureEncryptionKey } = await import("./crypto.js");
    ensureEncryptionKey();

    expect(process.env.CREDENTIALS_ENCRYPTION_KEY).toBe(TEST_KEY);
  });
});

describe("maskSecret", () => {
  it("masks long secrets showing last 4 chars", async () => {
    const { maskSecret } = await import("./crypto.js");
    expect(maskSecret("sk-ant-api03-secret-1234")).toBe("••••1234");
  });

  it("masks short secrets completely", async () => {
    const { maskSecret } = await import("./crypto.js");
    expect(maskSecret("abc")).toBe("••••");
    expect(maskSecret("abcd")).toBe("••••");
  });

  it("masks 5-char secrets showing last 4", async () => {
    const { maskSecret } = await import("./crypto.js");
    expect(maskSecret("12345")).toBe("••••2345");
  });
});
