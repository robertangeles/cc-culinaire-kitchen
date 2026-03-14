/**
 * @module utils/crypto
 *
 * AES-256-GCM encryption utilities for storing sensitive credentials
 * (API keys, OAuth secrets) at rest in the database.
 *
 * The encryption key is read from the `CREDENTIALS_ENCRYPTION_KEY`
 * environment variable, which must be a 64-character hex string (32 bytes).
 */

import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pino } from "pino";

const log = pino({ transport: { target: "pino-pretty" } });

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

/** Resolves the path to the monorepo root `.env` file. */
function getEnvPath(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return resolve(__dirname, "../../../../.env");
}

/**
 * Ensures `CREDENTIALS_ENCRYPTION_KEY` exists in `process.env`.
 * If missing, generates a random 32-byte key, appends it to `.env`,
 * and sets it on `process.env`. Call this once at server startup
 * before any encryption operations.
 */
export function ensureEncryptionKey(): void {
  if (process.env.CREDENTIALS_ENCRYPTION_KEY) return;

  const envPath = getEnvPath();

  // Check if the key already exists in the .env file (dotenv may not have loaded it)
  try {
    if (existsSync(envPath)) {
      const contents = readFileSync(envPath, "utf-8");
      const match = contents.match(/^CREDENTIALS_ENCRYPTION_KEY=([0-9a-f]{64})$/m);
      if (match) {
        process.env.CREDENTIALS_ENCRYPTION_KEY = match[1];
        log.info("Loaded CREDENTIALS_ENCRYPTION_KEY from .env");
        return;
      }
    }
  } catch {
    // Fall through to generate a new key
  }

  const key = randomBytes(32).toString("hex");
  process.env.CREDENTIALS_ENCRYPTION_KEY = key;

  try {
    const line = `\n# Auto-generated credential encryption key\nCREDENTIALS_ENCRYPTION_KEY=${key}\n`;
    appendFileSync(envPath, line, "utf-8");
    log.info("Generated CREDENTIALS_ENCRYPTION_KEY and saved to .env");
  } catch {
    log.warn(
      "Generated CREDENTIALS_ENCRYPTION_KEY in memory but could not write to .env. " +
        "Set it manually for persistence across restarts.",
    );
  }
}

/**
 * Returns the 32-byte encryption key from `CREDENTIALS_ENCRYPTION_KEY`.
 * Throws a descriptive error if the key is missing or malformed.
 */
export function getEncryptionKey(): Buffer {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set. Call ensureEncryptionKey() at startup.",
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes).",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Shape returned by {@link encrypt}. All values are hex-encoded strings. */
export interface EncryptedPayload {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The value to encrypt.
 * @returns Hex-encoded ciphertext, IV, and GCM auth tag.
 */
export function encrypt(plaintext: string): EncryptedPayload {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

/**
 * Decrypt a ciphertext produced by {@link encrypt}.
 *
 * @param ciphertext - Hex-encoded ciphertext.
 * @param iv - Hex-encoded initialization vector.
 * @param authTag - Hex-encoded GCM authentication tag.
 * @returns The original plaintext string.
 */
export function decrypt(ciphertext: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// PII Encryption (separate key from credential encryption)
// ---------------------------------------------------------------------------

/**
 * Ensures `PII_ENCRYPTION_KEY` and `PII_HMAC_KEY` exist in `process.env`.
 * If missing, generates random keys and appends them to `.env`.
 * Call at server startup alongside `ensureEncryptionKey()`.
 */
export function ensurePiiKeys(): void {
  const envPath = getEnvPath();

  for (const keyName of ["PII_ENCRYPTION_KEY", "PII_HMAC_KEY"] as const) {
    if (process.env[keyName]) continue;

    try {
      if (existsSync(envPath)) {
        const contents = readFileSync(envPath, "utf-8");
        const match = contents.match(new RegExp(`^${keyName}=([0-9a-f]{64})$`, "m"));
        if (match) {
          process.env[keyName] = match[1];
          log.info(`Loaded ${keyName} from .env`);
          continue;
        }
      }
    } catch {
      // Fall through to generate
    }

    const key = randomBytes(32).toString("hex");
    process.env[keyName] = key;

    try {
      const line = `\n# Auto-generated PII key\n${keyName}=${key}\n`;
      appendFileSync(envPath, line, "utf-8");
      log.info(`Generated ${keyName} and saved to .env`);
    } catch {
      log.warn(`Generated ${keyName} in memory but could not write to .env.`);
    }
  }
}

/** Returns the 32-byte PII encryption key. */
function getPiiEncryptionKey(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("PII_ENCRYPTION_KEY is not set or invalid. Call ensurePiiKeys() at startup.");
  }
  return Buffer.from(hex, "hex");
}

/** Returns the 32-byte PII HMAC key. */
function getPiiHmacKey(): Buffer {
  const hex = process.env.PII_HMAC_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error("PII_HMAC_KEY is not set or invalid. Call ensurePiiKeys() at startup.");
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt a PII field using AES-256-GCM with the PII-specific key.
 * Returns null fields if the input is null/undefined/empty.
 */
export function encryptPii(
  plaintext: string | null | undefined,
): { enc: string; iv: string; tag: string } | null {
  if (!plaintext) return null;

  const key = getPiiEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    enc: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

/**
 * Decrypt a PII field encrypted with {@link encryptPii}.
 * Returns null if any parameter is missing.
 */
export function decryptPii(
  enc: string | null,
  iv: string | null,
  tag: string | null,
): string | null {
  if (!enc || !iv || !tag) return null;

  const key = getPiiEncryptionKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(enc, "hex")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Compute a deterministic HMAC-SHA256 hash for blind-index lookups.
 * Used for searchable encrypted fields (e.g. email).
 * Always lowercases input for consistent hashing.
 */
export function hashForLookup(plaintext: string): string {
  return createHmac("sha256", getPiiHmacKey())
    .update(plaintext.toLowerCase())
    .digest("hex");
}

/**
 * Mask a secret value for safe display in the admin UI.
 *
 * @param value - The original secret string.
 * @returns A masked string showing only the last 4 characters.
 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}
