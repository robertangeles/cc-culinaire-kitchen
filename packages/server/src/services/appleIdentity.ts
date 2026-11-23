/**
 * @module services/appleIdentity
 *
 * Everything that talks to, or trusts, Apple for Sign in with Apple: checking an identity token against
 * Apple's published keys, and the two server-to-server calls that need our Apple key (swap the sign-in's
 * authorization code for a refresh token, and revoke that token when the account is deleted).
 * No database here; `appleSignInService` decides what the verified claims mean for an account.
 *
 * Uses `jsonwebtoken` and `node:crypto` only: a JWK becomes a public key with `createPublicKey`, so no
 * JOSE library is added for one RS256 check and one ES256 signature.
 *
 * Settings (Integrations panel, read at call time like the Google ones):
 *   APPLE_CLIENT_ID     the iOS app's bundle id; the identity token's audience. Needed to sign in.
 *   APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY   the Sign in with Apple key (.p8). Needed only to revoke.
 */

import crypto from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import pino from "pino";
import { AuthError } from "./authService.js";

const log = pino({ name: "appleIdentity" });

const APPLE_ISSUER = "https://appleid.apple.com";
const KEYS_URL = `${APPLE_ISSUER}/auth/keys`;
const TOKEN_URL = `${APPLE_ISSUER}/auth/token`;
const REVOKE_URL = `${APPLE_ISSUER}/auth/revoke`;

const CALL_TIMEOUT_MS = 10_000;
/** Apple rotates its keys rarely; a day-old copy is refreshed so a withdrawn key does not live as long as the process. */
const KEYS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** An unknown key id may mean a rotation, but a flood of forged tokens must not become a flood of Apple calls. */
const KEYS_REFETCH_SPACING_MS = 60 * 1000;

const clientId = () => process.env.APPLE_CLIENT_ID || undefined;

/** A pasted `.p8` often arrives with literal `\n` sequences instead of line breaks. */
const privateKey = () => process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, "\n") || undefined;

/** True when the key needed to call Apple's token and revoke endpoints is set (sign-in itself needs only the app id). */
export function isAppleRevocationConfigured(): boolean {
  return Boolean(clientId() && process.env.APPLE_TEAM_ID && process.env.APPLE_KEY_ID && privateKey());
}

export interface AppleClaims {
  /** Apple's stable id for this person and this app. The only thing an account is ever matched on. */
  sub: string;
  /** Absent when Apple withheld it. A private-relay address when {@link isPrivateEmail}. */
  email?: string;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

// ---------------------------------------------------------------------------
// Apple's published keys
// ---------------------------------------------------------------------------

let keys = new Map<string, crypto.KeyObject>();
let keysFetchedAt = 0;

/** Test hook: forget the cached key set. */
export function resetAppleKeyCache(): void {
  keys = new Map();
  keysFetchedAt = 0;
}

const unavailable = () => new AuthError("Apple sign-in is unavailable right now. Try again in a moment.", "APPLE_UNAVAILABLE", 503);

async function refetchKeys(): Promise<void> {
  let body: { keys?: Array<crypto.JsonWebKey & { kid?: string }> };
  try {
    const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch (err) {
    keysFetchedAt = Date.now(); // spaced like a success: do not hammer Apple while it is down
    log.error({ err }, "Could not fetch Apple's signing keys");
    throw unavailable();
  }
  const fresh = new Map<string, crypto.KeyObject>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kid && jwk.kty === "RSA") fresh.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: "jwk" }));
  }
  keys = fresh;
  keysFetchedAt = Date.now();
}

async function keyFor(kid: string): Promise<crypto.KeyObject | undefined> {
  const age = Date.now() - keysFetchedAt;
  if (keys.size === 0) {
    if (keysFetchedAt > 0 && age < KEYS_REFETCH_SPACING_MS) throw unavailable();
    await refetchKeys();
  } else if (age > KEYS_MAX_AGE_MS) await refetchKeys();
  else if (!keys.has(kid) && age > KEYS_REFETCH_SPACING_MS) await refetchKeys();
  return keys.get(kid);
}

// ---------------------------------------------------------------------------
// Identity token
// ---------------------------------------------------------------------------

const invalidToken = () => new AuthError("Apple sign-in could not be verified.", "APPLE_TOKEN_INVALID", 401);

const sha256Hex = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Apple sends these flags as the string "true" in some tokens and as a boolean in others. */
const flag = (value: unknown) => value === true || value === "true";

/**
 * Checks an identity token from the phone: signature against Apple's published keys (RS256 only), issuer,
 * audience (our app id), expiry, and the nonce. The phone sends Apple the SHA-256 of a random nonce and sends
 * us the random value itself, so a token captured from one sign-in cannot be presented for another request.
 * `maxAgeSeconds` also bounds how long ago Apple issued it (account deletion and linking use it). The nonce is
 * chosen by the phone, so a token plus its nonce captured together could be replayed inside that window; a
 * server-issued single-use nonce would close it and is not built.
 *
 * @throws {AuthError} APPLE_NOT_CONFIGURED (503), APPLE_UNAVAILABLE (503), APPLE_TOKEN_INVALID (401).
 */
export async function verifyAppleIdentityToken(
  identityToken: string,
  rawNonce: string,
  opts: { maxAgeSeconds?: number } = {},
): Promise<AppleClaims> {
  const audience = clientId();
  if (!audience) throw new AuthError("Sign in with Apple is not set up on this server.", "APPLE_NOT_CONFIGURED", 503);

  const decoded = jwt.decode(identityToken, { complete: true });
  const kid = decoded?.header.kid;
  if (!decoded || decoded.header.alg !== "RS256" || !kid) throw invalidToken();

  const key = await keyFor(kid);
  if (!key) throw invalidToken();

  let payload: JwtPayload;
  try {
    payload = jwt.verify(identityToken, key, {
      algorithms: ["RS256"],
      issuer: APPLE_ISSUER,
      audience,
      // Sensitive actions pass a short age: the token must have been issued moments ago, not merely not yet expired.
      ...(opts.maxAgeSeconds ? { maxAge: opts.maxAgeSeconds } : {}),
    }) as JwtPayload;
  } catch (err) {
    log.warn({ reason: err instanceof Error ? err.message : "unknown" }, "Apple identity token rejected");
    throw invalidToken();
  }

  if (typeof payload.sub !== "string" || payload.sub === "") throw invalidToken();
  if (typeof payload.nonce !== "string" || payload.nonce !== sha256Hex(rawNonce)) {
    log.warn("Apple identity token rejected: nonce does not match");
    throw invalidToken();
  }

  return {
    sub: payload.sub,
    email: typeof payload.email === "string" && payload.email !== "" ? payload.email : undefined,
    emailVerified: flag(payload.email_verified),
    isPrivateEmail: flag(payload.is_private_email),
  };
}

// ---------------------------------------------------------------------------
// Token and revoke endpoints
// ---------------------------------------------------------------------------

/** The short-lived JWT that proves to Apple that this server holds our Sign in with Apple key. */
function clientSecret(): string {
  return jwt.sign({}, privateKey()!, {
    algorithm: "ES256",
    keyid: process.env.APPLE_KEY_ID,
    issuer: process.env.APPLE_TEAM_ID,
    audience: APPLE_ISSUER,
    subject: clientId(),
    expiresIn: "5m",
  });
}

function appleForm(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams({ client_id: clientId()!, client_secret: clientSecret(), ...fields });
}

async function postForm(url: string, form: URLSearchParams): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });
}

/**
 * Swaps the sign-in's authorization code for Apple's refresh token, which is what a later account deletion
 * must revoke. Best effort: returns null when revocation is not set up or Apple refuses (a code works once and
 * only for a few minutes), because failing the sign-in over it would lock the person out of the app.
 */
export async function exchangeAuthorizationCode(code: string): Promise<string | null> {
  if (!isAppleRevocationConfigured()) return null;
  try {
    const res = await postForm(TOKEN_URL, appleForm({ grant_type: "authorization_code", code }));
    const body = (await res.json()) as { refresh_token?: unknown };
    if (!res.ok || typeof body.refresh_token !== "string") {
      log.warn({ status: res.status }, "Apple did not give a refresh token for the authorization code");
      return null;
    }
    return body.refresh_token;
  } catch (err) {
    log.warn({ err }, "Could not exchange the Apple authorization code");
    return null;
  }
}

/**
 * Revokes a refresh token at Apple (App Store rule: an app with Sign in with Apple revokes the token when the
 * account is deleted). A token Apple already calls invalid counts as revoked.
 *
 * @throws {Error} when Apple could not be reached or refused for any other reason.
 */
export async function revokeAppleRefreshToken(refreshToken: string): Promise<void> {
  const res = await postForm(REVOKE_URL, appleForm({ token: refreshToken, token_type_hint: "refresh_token" }));
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (res.status === 400 && body.error === "invalid_grant") return;
  throw new Error(`Apple revoke failed with HTTP ${res.status}`);
}
