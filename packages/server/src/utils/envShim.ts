/**
 * @module utils/envShim
 *
 * Single-`.env` indirection. The repo holds one `.env` with `DEV_*` and
 * `PROD_*` prefixed variants of every env-specific value. At process start
 * (immediately after `dotenv.config()`), this shim reads `APP_ENV` (default
 * `dev`) and copies the matching prefixed value into the unprefixed slot
 * that the rest of the code already consumes.
 *
 * Render's prod environment supplies unprefixed vars directly from its
 * dashboard, so the shim is a no-op there.
 */

const PREFIXED_KEYS = [
  "DATABASE_URL",
  "CLIENT_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CREDENTIALS_ENCRYPTION_KEY",
  "PII_ENCRYPTION_KEY",
  "PII_HMAC_KEY",
  "TRUST_PROXY",
] as const;

export function applyEnvPrefix(): void {
  const appEnv = (process.env.APP_ENV ?? "dev").toUpperCase();
  for (const key of PREFIXED_KEYS) {
    const v = process.env[`${appEnv}_${key}`];
    if (v !== undefined && v !== "") {
      process.env[key] = v;
    }
  }
}

/**
 * Is this a production process?
 *
 * The single definition of that question. `assertSafeDbHost` (db/index.ts) uses
 * it as the hard rail that lets a prod process reach the prod database host — so
 * production MUST satisfy this predicate, otherwise the server could not connect
 * to its own database at all. That makes it safe to key production-only
 * behaviour (e.g. scheduled background jobs) off it without risking a silent
 * production outage.
 */
export function isProductionProcess(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    (process.env.APP_ENV ?? "").toLowerCase() === "prod"
  );
}
