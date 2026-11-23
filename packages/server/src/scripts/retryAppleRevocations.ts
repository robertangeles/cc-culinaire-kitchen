/**
 * @module scripts/retryAppleRevocations
 *
 * Tries again to revoke the Sign in with Apple tokens of deleted accounts whose revoke call failed at deletion
 * time (they wait, encrypted, in `apple_revocation_retries`). Needs the Apple key settings
 * (APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY) in the environment the script points at.
 * Safe to run any time and as often as wanted; a row leaves the table only when Apple accepts the revoke.
 *
 *   pnpm --filter @culinaire/server exec tsx src/scripts/retryAppleRevocations.ts
 *   (production: prefix with APP_ENV=prod, as for migrate.ts)
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { hydrateEnvFromCredentials } = await import("../services/credentialService.js");
const { retryAppleRevocations } = await import("../services/appleSignInService.js");
const { isAppleRevocationConfigured } = await import("../services/appleIdentity.js");

async function main(): Promise<void> {
  await hydrateEnvFromCredentials();
  if (!isAppleRevocationConfigured()) throw new Error("The Apple key settings are not set up here.");
  const { revoked, remaining } = await retryAppleRevocations();
  console.log(`Revoked ${revoked}; ${remaining} still queued.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Retry failed:", err);
    process.exit(1);
  });
