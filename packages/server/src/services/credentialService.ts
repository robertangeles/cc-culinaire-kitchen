/**
 * @module credentialService
 *
 * Service layer for managing encrypted integration credentials
 * (API keys, OAuth secrets, Stripe keys, etc.) stored in the
 * `credential` table.
 *
 * Provides an in-memory cache similar to {@link module:settingsService}.
 * On startup, {@link hydrateEnvFromCredentials} loads all stored
 * credentials into `process.env` so that third-party SDKs and
 * module-level env reads work transparently.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { credential } from "../db/schema.js";
import { encrypt, decrypt, maskSecret } from "../utils/crypto.js";

// ---------------------------------------------------------------------------
// Credential registry — defines all known credential keys
// ---------------------------------------------------------------------------

interface CredentialMeta {
  category: string;
  label: string;
  sensitive: boolean;
}

/** Registry of known credential keys with display metadata. */
export const CREDENTIAL_REGISTRY: Record<string, CredentialMeta> = {
  GOOGLE_CLIENT_ID:         { category: "oauth",    label: "Google Client ID (Web)",                  sensitive: true },
  GOOGLE_CLIENT_SECRET:     { category: "oauth",    label: "Google Client Secret (Web)",              sensitive: true },
  GOOGLE_CALLBACK_URL:      { category: "oauth",    label: "Google Callback URL (Web)",               sensitive: true },
  // Mobile native Google Sign-In (used by /api/auth/google/idtoken).
  // Client IDs are public — they ship inside the mobile app binary.
  GOOGLE_ANDROID_CLIENT_ID: { category: "oauth",    label: "Google Client ID (Android — native sign-in)", sensitive: false },
  GOOGLE_IOS_CLIENT_ID:     { category: "oauth",    label: "Google Client ID (iOS — native sign-in)",     sensitive: false },
  OPENROUTER_API_KEY:      { category: "ai",       label: "OpenRouter API Key",      sensitive: true },
  AI_MODEL:                { category: "ai",       label: "Chat Model (OpenRouter format)", sensitive: false },
  RESEND_API_KEY:          { category: "email",    label: "Resend API Key",          sensitive: true },
  RESEND_FROM_EMAIL:       { category: "email",    label: "Resend From Email",       sensitive: false },
  STRIPE_SECRET_KEY:       { category: "payments", label: "Stripe Secret Key",       sensitive: true },
  STRIPE_PUBLISHABLE_KEY:  { category: "payments", label: "Stripe Publishable Key",  sensitive: false },
  STRIPE_WEBHOOK_SECRET:   { category: "payments", label: "Stripe Webhook Secret",   sensitive: true },
  STRIPE_PRICE_MONTHLY:    { category: "payments", label: "Stripe Monthly Price ID", sensitive: false },
  STRIPE_PRICE_YEARLY:     { category: "payments", label: "Stripe Yearly Price ID",  sensitive: false },
  RECAPTCHA_SITE_KEY:      { category: "security", label: "reCAPTCHA Site Key",      sensitive: false },
  RECAPTCHA_SECRET_KEY:    { category: "security", label: "reCAPTCHA Secret Key",    sensitive: true },
  DATABASE_URL:            { category: "database", label: "Database Connection URL", sensitive: true },
  CLOUDINARY_CLOUD_NAME:   { category: "cloudinary", label: "Cloud Name",           sensitive: false },
  CLOUDINARY_API_KEY:      { category: "cloudinary", label: "API Key",              sensitive: true },
  CLOUDINARY_API_SECRET:   { category: "cloudinary", label: "API Secret",           sensitive: true },
};

/** Category display order and labels for the frontend. */
export const CREDENTIAL_CATEGORIES = [
  { id: "oauth",    label: "OAuth Providers" },
  { id: "ai",       label: "AI Configuration" },
  { id: "email",    label: "Email" },
  { id: "payments", label: "Payments" },
  { id: "security", label: "Security" },
  { id: "database", label: "Database" },
  { id: "cloudinary", label: "Cloudinary (Images)" },
];

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

/** Cache of decrypted credential values: key → plaintext. */
let cache: Map<string, string> | null = null;

/** Set of keys that have a stored DB value (vs. env-only). */
let storedKeys: Set<string> | null = null;

/** Invalidate the in-memory cache. */
function invalidateCache() {
  cache = null;
  storedKeys = null;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/** Shape returned by {@link listCredentials} for each key. */
export interface CredentialListItem {
  key: string;
  label: string;
  category: string;
  sensitive: boolean;
  value: string;
  hasValue: boolean;
  source: "db" | "env" | "none";
  updatedDttm: Date | null;
}

/**
 * List all known credentials with masked sensitive values.
 * Shows whether each credential is stored in DB, from env, or not set.
 */
export async function listCredentials(): Promise<CredentialListItem[]> {
  const rows = await db.select().from(credential);
  const dbMap = new Map(
    rows.map((r) => [r.credentialKey, r]),
  );

  return Object.entries(CREDENTIAL_REGISTRY).map(([key, meta]) => {
    const row = dbMap.get(key);
    let value = "";
    let source: "db" | "env" | "none" = "none";
    let hasValue = false;

    if (row) {
      try {
        const decrypted = decrypt(row.credentialValue, row.credentialIv, row.credentialTag);
        value = meta.sensitive ? maskSecret(decrypted) : decrypted;
        source = "db";
        hasValue = true;
      } catch {
        value = "";
        source = "db";
        hasValue = false;
      }
    } else if (process.env[key]) {
      const envVal = process.env[key]!;
      value = meta.sensitive ? maskSecret(envVal) : envVal;
      source = "env";
      hasValue = true;
    }

    return {
      key,
      label: meta.label,
      category: meta.category,
      sensitive: meta.sensitive,
      value,
      hasValue,
      source,
      updatedDttm: row?.updatedDttm ?? null,
    };
  });
}

/**
 * Get the decrypted value for a single credential key.
 * Returns from cache if available, otherwise queries DB.
 */
async function getCredentialValue(key: string): Promise<string | null> {
  if (cache?.has(key)) return cache.get(key)!;

  const rows = await db
    .select()
    .from(credential)
    .where(eq(credential.credentialKey, key));

  if (rows.length === 0) return null;

  const row = rows[0];
  const value = decrypt(row.credentialValue, row.credentialIv, row.credentialTag);

  if (!cache) cache = new Map();
  cache.set(key, value);

  return value;
}

/**
 * Get the credential value with env var fallback.
 * Checks DB first, then falls back to `process.env[key]`.
 */
export async function getCredentialValueWithFallback(key: string): Promise<string> {
  const dbValue = await getCredentialValue(key);
  if (dbValue !== null) return dbValue;
  return process.env[key] ?? "";
}

/**
 * Upsert a credential: encrypt and store in DB, then update process.env
 * so changes take effect immediately without restart.
 */
export async function upsertCredential(
  key: string,
  plaintext: string,
  updatedBy: number,
): Promise<void> {
  const meta = CREDENTIAL_REGISTRY[key];
  if (!meta) throw new Error(`Unknown credential key: ${key}`);

  const { ciphertext, iv, authTag } = encrypt(plaintext);

  const existing = await db
    .select({ credentialId: credential.credentialId })
    .from(credential)
    .where(eq(credential.credentialKey, key));

  if (existing.length > 0) {
    await db
      .update(credential)
      .set({
        credentialValue: ciphertext,
        credentialIv: iv,
        credentialTag: authTag,
        updatedBy,
        updatedDttm: new Date(),
      })
      .where(eq(credential.credentialId, existing[0].credentialId));
  } else {
    await db.insert(credential).values({
      credentialKey: key,
      credentialValue: ciphertext,
      credentialIv: iv,
      credentialTag: authTag,
      credentialCategory: meta.category,
      updatedBy,
    });
  }

  // Update process.env so changes take effect immediately
  process.env[key] = plaintext;

  invalidateCache();
}

/**
 * Delete a credential from the database, reverting to env var fallback.
 * Also removes the process.env override set by upsertCredential.
 */
export async function deleteCredential(key: string): Promise<void> {
  await db.delete(credential).where(eq(credential.credentialKey, key));

  // Remove the DB-sourced value; the original env var (if any) remains
  // since we only set process.env in upsertCredential
  invalidateCache();
}

/**
 * Reveal the full unmasked value of a credential.
 * Returns the decrypted DB value, or falls back to `process.env[key]`.
 * Returns null if the credential is not configured anywhere.
 */
export async function revealCredential(key: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(credential)
    .where(eq(credential.credentialKey, key));

  if (rows.length > 0) {
    return decrypt(rows[0].credentialValue, rows[0].credentialIv, rows[0].credentialTag);
  }

  return process.env[key] ?? null;
}

/**
 * Load all stored credentials from DB into `process.env`.
 * Called once at server startup, before services that read env vars
 * at module scope.
 */
export async function hydrateEnvFromCredentials(): Promise<void> {
  try {
    const rows = await db.select().from(credential);

    for (const row of rows) {
      try {
        const value = decrypt(row.credentialValue, row.credentialIv, row.credentialTag);
        process.env[row.credentialKey] = value;
      } catch {
        // Skip credentials that fail to decrypt (e.g. key rotation)
      }
    }
  } catch {
    // DB may not be available yet or table may not exist — silent fallback to env vars
  }
}
