import { describe, it, expect, vi, beforeEach } from "vitest";

// A plain function, not vi.fn(): the spy library reports a rejection it recorded as an error even when the code under test handled it.
const apple: { calls: unknown[]; result: unknown; error?: unknown } = { calls: [], result: undefined };
vi.mock("expo-apple-authentication", () => ({
  signInAsync: async (options: unknown) => {
    apple.calls.push(options);
    if (apple.error) throw apple.error;
    return apple.result;
  },
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
vi.mock("expo-crypto", () => ({
  getRandomBytesAsync: vi.fn(async () => Uint8Array.from({ length: 32 }, (_, i) => i)),
  digestStringAsync: vi.fn(async (_algorithm: string, value: string) => `sha256(${value})`),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
}));

import { appleCredential } from "./appleSignIn";

const RAW = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");

beforeEach(() => Object.assign(apple, { calls: [], result: undefined, error: undefined }));

describe("appleCredential", () => {
  it("gives Apple the SHA-256 of a random nonce and keeps the raw value for the server, so the token is tied to this attempt", async () => {
    apple.result = { identityToken: "TOKEN", authorizationCode: "CODE", fullName: { givenName: "Ada", familyName: "Lovelace" } };
    const credential = await appleCredential();
    expect(apple.calls).toEqual([{ requestedScopes: [0, 1], nonce: `sha256(${RAW})` }]);
    expect(credential).toEqual({ identityToken: "TOKEN", nonce: RAW, authorizationCode: "CODE", givenName: "Ada", familyName: "Lovelace" });
  });

  it("sends no name when Apple gave none (every sign-in after the first)", async () => {
    apple.result = { identityToken: "TOKEN", authorizationCode: null, fullName: null };
    expect(await appleCredential()).toEqual({ identityToken: "TOKEN", nonce: RAW, authorizationCode: undefined, givenName: undefined, familyName: undefined });
  });

  it("returns null, not an error, when the person closes the sheet", async () => {
    apple.error = Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" });
    expect(await appleCredential()).toBeNull();
  });

  it("throws when Apple's sheet fails for any other reason, or returns no identity token", async () => {
    apple.error = Object.assign(new Error("failed"), { code: "ERR_REQUEST_FAILED" });
    await expect(appleCredential()).rejects.toThrow("failed");
    apple.error = undefined;
    apple.result = { identityToken: null };
    await expect(appleCredential()).rejects.toThrow(/identity token/);
  });

  it("uses a new nonce for every attempt", async () => {
    const { getRandomBytesAsync } = await import("expo-crypto");
    vi.mocked(getRandomBytesAsync).mockResolvedValueOnce(new Uint8Array(32).fill(1)).mockResolvedValueOnce(new Uint8Array(32).fill(2));
    apple.result = { identityToken: "T" };
    const a = await appleCredential();
    const b = await appleCredential();
    expect(a!.nonce).not.toBe(b!.nonce);
  });
});
