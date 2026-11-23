import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import {
  verifyAppleIdentityToken,
  exchangeAuthorizationCode,
  revokeAppleRefreshToken,
  isAppleRevocationConfigured,
  resetAppleKeyCache,
} from "./appleIdentity.js";

/**
 * Apple's identity token is checked here with a key set made for the test and a stubbed `fetch`: no real
 * Apple call is made. What this CANNOT show is that Apple's real keys, audience and nonce behaviour match
 * what is assumed here; that needs a real device and real credentials (see the PR's owner checklist).
 */
const CLIENT_ID = "com.culinairekitchen.chef";
const RAW_NONCE = "n-0123456789abcdef0123456789abcdef";
const hashed = (n: string) => crypto.createHash("sha256").update(n).digest("hex");

function makeKey(kid: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}

const keyA = makeKey("kidA");
const keyB = makeKey("kidB");

let published: ReturnType<typeof makeKey>[];
let fetchCalls: Array<{ url: string; body?: string }>;
let tokenEndpoint: { status: number; body: unknown };
let revokeEndpoint: { status: number; body: unknown };

function sign(overrides: Record<string, unknown> = {}, key = keyA, opts: jwt.SignOptions = {}) {
  const payload = { sub: "001234.abcd", email: "chef@example.com", email_verified: "true", nonce: hashed(RAW_NONCE), ...overrides };
  return jwt.sign(payload, key.privateKey, {
    algorithm: "RS256",
    keyid: key.kid,
    issuer: "https://appleid.apple.com",
    audience: CLIENT_ID,
    expiresIn: "10m",
    ...opts,
  });
}

beforeEach(() => {
  resetAppleKeyCache();
  published = [keyA];
  fetchCalls = [];
  tokenEndpoint = { status: 200, body: { refresh_token: "r-abc" } };
  revokeEndpoint = { status: 200, body: {} };
  process.env.APPLE_CLIENT_ID = CLIENT_ID;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
      fetchCalls.push({ url, body: init?.body?.toString() });
      if (url === "https://appleid.apple.com/auth/keys") return Response.json({ keys: published.map((k) => k.jwk) });
      if (url === "https://appleid.apple.com/auth/token") return Response.json(tokenEndpoint.body, { status: tokenEndpoint.status });
      if (url === "https://appleid.apple.com/auth/revoke") return Response.json(revokeEndpoint.body, { status: revokeEndpoint.status });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APPLE_CLIENT_ID;
  delete process.env.APPLE_TEAM_ID;
  delete process.env.APPLE_KEY_ID;
  delete process.env.APPLE_PRIVATE_KEY;
});

const invalid = { code: "APPLE_TOKEN_INVALID", statusCode: 401 };

describe("verifyAppleIdentityToken", () => {
  it("accepts a token signed by a published key and returns the subject and email", async () => {
    const claims = await verifyAppleIdentityToken(sign(), RAW_NONCE);
    expect(claims).toEqual({ sub: "001234.abcd", email: "chef@example.com", emailVerified: true, isPrivateEmail: false });
  });

  it("reads Apple's string-or-boolean flags: email_verified and is_private_email", async () => {
    const a = await verifyAppleIdentityToken(sign({ email_verified: true, is_private_email: "true", email: "x@privaterelay.appleid.com" }), RAW_NONCE);
    expect(a).toMatchObject({ emailVerified: true, isPrivateEmail: true });
    const b = await verifyAppleIdentityToken(sign({ email_verified: "false" }), RAW_NONCE);
    expect(b.emailVerified).toBe(false);
    const c = await verifyAppleIdentityToken(sign({ email_verified: undefined }), RAW_NONCE);
    expect(c.emailVerified).toBe(false);
  });

  it("returns no email when Apple sends none", async () => {
    const claims = await verifyAppleIdentityToken(sign({ email: undefined, email_verified: undefined }), RAW_NONCE);
    expect(claims.email).toBeUndefined();
  });

  it("rejects a token signed by a key Apple does not publish", async () => {
    const stranger = makeKey("kidA"); // same kid, different key
    await expect(verifyAppleIdentityToken(sign({}, stranger), RAW_NONCE)).rejects.toMatchObject(invalid);
  });

  it("rejects the wrong issuer, the wrong audience and an expired token", async () => {
    await expect(verifyAppleIdentityToken(sign({}, keyA, { issuer: "https://evil.example.com" }), RAW_NONCE)).rejects.toMatchObject(invalid);
    await expect(verifyAppleIdentityToken(sign({}, keyA, { audience: "com.someone.else" }), RAW_NONCE)).rejects.toMatchObject(invalid);
    await expect(verifyAppleIdentityToken(sign({}, keyA, { expiresIn: "-1m" }), RAW_NONCE)).rejects.toMatchObject(invalid);
  });

  it("rejects a missing or mismatched nonce, so a captured token cannot be replayed for another request", async () => {
    await expect(verifyAppleIdentityToken(sign({ nonce: undefined }), RAW_NONCE)).rejects.toMatchObject(invalid);
    await expect(verifyAppleIdentityToken(sign(), "a-different-nonce-0123456789abcdef")).rejects.toMatchObject(invalid);
    // The token carries the hash; presenting the hash itself as the nonce must not pass.
    await expect(verifyAppleIdentityToken(sign(), hashed(RAW_NONCE))).rejects.toMatchObject(invalid);
  });

  it("with a maximum age, rejects a token issued longer ago than that even though it has not expired", async () => {
    const issuedTenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
    const old = sign({ iat: issuedTenMinutesAgo }, keyA, { expiresIn: "1h" });
    await expect(verifyAppleIdentityToken(old, RAW_NONCE, { maxAgeSeconds: 300 })).rejects.toMatchObject(invalid);
    await expect(verifyAppleIdentityToken(old, RAW_NONCE)).resolves.toMatchObject({ sub: "001234.abcd" });
    await expect(verifyAppleIdentityToken(sign(), RAW_NONCE, { maxAgeSeconds: 300 })).resolves.toMatchObject({ sub: "001234.abcd" });
  });

  it("rejects a token with no subject", async () => {
    await expect(verifyAppleIdentityToken(sign({ sub: "" }), RAW_NONCE)).rejects.toMatchObject(invalid);
  });

  it("rejects an unsigned token and an HMAC token made with the public key as the secret", async () => {
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "kidA" })).toString("base64url")}.${Buffer.from(
      JSON.stringify({ sub: "x", iss: "https://appleid.apple.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, nonce: hashed(RAW_NONCE) }),
    ).toString("base64url")}.`;
    await expect(verifyAppleIdentityToken(none, RAW_NONCE)).rejects.toMatchObject(invalid);

    const hmac = jwt.sign({ sub: "x", nonce: hashed(RAW_NONCE) }, JSON.stringify(keyA.jwk), {
      algorithm: "HS256",
      keyid: "kidA",
      issuer: "https://appleid.apple.com",
      audience: CLIENT_ID,
      expiresIn: "10m",
    });
    await expect(verifyAppleIdentityToken(hmac, RAW_NONCE)).rejects.toMatchObject(invalid);
  });

  it("rejects garbage", async () => {
    await expect(verifyAppleIdentityToken("not-a-jwt", RAW_NONCE)).rejects.toMatchObject(invalid);
  });

  it("answers APPLE_NOT_CONFIGURED (503) when the app id is not set, without calling Apple", async () => {
    delete process.env.APPLE_CLIENT_ID;
    await expect(verifyAppleIdentityToken(sign(), RAW_NONCE)).rejects.toMatchObject({ code: "APPLE_NOT_CONFIGURED", statusCode: 503 });
    expect(fetchCalls).toHaveLength(0);
  });

  it("fetches Apple's keys once and reuses them", async () => {
    await verifyAppleIdentityToken(sign(), RAW_NONCE);
    await verifyAppleIdentityToken(sign(), RAW_NONCE);
    expect(fetchCalls.filter((c) => c.url.endsWith("/auth/keys"))).toHaveLength(1);
  });

  it("picks up a key Apple rotated in: an unknown kid triggers one refetch", async () => {
    await verifyAppleIdentityToken(sign(), RAW_NONCE);
    published = [keyA, keyB];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 2 * 60_000); // past the refetch spacing
    try {
      await expect(verifyAppleIdentityToken(sign({}, keyB), RAW_NONCE)).resolves.toMatchObject({ sub: "001234.abcd" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refetch Apple's keys on every unknown kid: a flood of bad tokens must not become a flood of Apple calls", async () => {
    await verifyAppleIdentityToken(sign(), RAW_NONCE);
    for (let i = 0; i < 5; i++) await expect(verifyAppleIdentityToken(sign({}, keyB), RAW_NONCE)).rejects.toMatchObject(invalid);
    expect(fetchCalls.filter((c) => c.url.endsWith("/auth/keys"))).toHaveLength(1);
  });

  it("answers APPLE_UNAVAILABLE (503) when Apple's key set cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(verifyAppleIdentityToken(sign(), RAW_NONCE)).rejects.toMatchObject({ code: "APPLE_UNAVAILABLE", statusCode: 503 });
  });
});

describe("Apple token endpoint", () => {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  function configure(key = pem) {
    process.env.APPLE_TEAM_ID = "TEAM123456";
    process.env.APPLE_KEY_ID = "KEY1234567";
    process.env.APPLE_PRIVATE_KEY = key;
  }

  it("is configured for revocation only when team id, key id and key are all set", () => {
    expect(isAppleRevocationConfigured()).toBe(false);
    configure();
    expect(isAppleRevocationConfigured()).toBe(true);
    delete process.env.APPLE_KEY_ID;
    expect(isAppleRevocationConfigured()).toBe(false);
  });

  it("exchanges the authorization code with a client secret Apple can verify, and returns the refresh token", async () => {
    configure();
    expect(await exchangeAuthorizationCode("code-1")).toBe("r-abc");
    const call = fetchCalls.find((c) => c.url.endsWith("/auth/token"))!;
    const form = new URLSearchParams(call.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("code-1");
    expect(form.get("client_id")).toBe(CLIENT_ID);
    const secret = jwt.verify(form.get("client_secret")!, crypto.createPublicKey(privateKey), {
      algorithms: ["ES256"],
      issuer: "TEAM123456",
      audience: "https://appleid.apple.com",
      subject: CLIENT_ID,
      complete: true,
    });
    expect(secret.header.kid).toBe("KEY1234567");
  });

  it("accepts the key pasted with literal \\n sequences, as an environment variable often arrives", async () => {
    configure(pem.trim().replace(/\n/g, "\\n"));
    expect(await exchangeAuthorizationCode("code-1")).toBe("r-abc");
  });

  it("returns null without calling Apple when revocation is not configured", async () => {
    expect(await exchangeAuthorizationCode("code-1")).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  it("returns null when Apple refuses the code (sign-in itself must not fail over it)", async () => {
    configure();
    tokenEndpoint = { status: 400, body: { error: "invalid_grant" } };
    expect(await exchangeAuthorizationCode("used-code")).toBeNull();
  });

  it("revokes the refresh token at Apple's revoke endpoint", async () => {
    configure();
    await revokeAppleRefreshToken("r-abc");
    const form = new URLSearchParams(fetchCalls.find((c) => c.url.endsWith("/auth/revoke"))!.body);
    expect(form.get("token")).toBe("r-abc");
    expect(form.get("token_type_hint")).toBe("refresh_token");
    expect(form.get("client_id")).toBe(CLIENT_ID);
  });

  it("throws when Apple refuses the revoke, so the caller can record it", async () => {
    configure();
    revokeEndpoint = { status: 500, body: {} };
    await expect(revokeAppleRefreshToken("r-abc")).rejects.toThrow(/revoke/i);
  });

  it("treats a token Apple says is already invalid as revoked", async () => {
    configure();
    revokeEndpoint = { status: 400, body: { error: "invalid_grant" } };
    await expect(revokeAppleRefreshToken("r-abc")).resolves.toBeUndefined();
  });
});
