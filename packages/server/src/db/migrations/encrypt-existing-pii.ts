/**
 * @module db/migrations/encrypt-existing-pii
 *
 * Data migration: Reads all existing user and organisation rows,
 * encrypts PII fields using AES-256-GCM, and writes the ciphertext
 * to the new encryption columns. Also computes HMAC-SHA256 blind
 * indexes for email fields.
 *
 * Idempotent — rows that already have encrypted values are skipped.
 *
 * Prerequisites:
 *   - PII_ENCRYPTION_KEY and PII_HMAC_KEY must be set in .env
 *   - Run add-pii-encryption-columns migration first
 *
 * Usage:
 * ```sh
 * npx tsx src/db/migrations/encrypt-existing-pii.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";
import { encryptPii, hashForLookup, ensurePiiKeys } from "../../utils/crypto.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

ensurePiiKeys();

const sql = postgres(DATABASE_URL);

async function migrate() {
  console.log("Starting PII data encryption...");

  // -----------------------------------------------------------------------
  // 1. Encrypt user PII
  // -----------------------------------------------------------------------
  const users = await sql`
    SELECT user_id, user_name, user_email, user_bio,
           user_address_line1, user_address_line2, user_suburb,
           user_state, user_country, user_postcode,
           user_name_enc
    FROM "user"
  `;

  let userCount = 0;
  for (const u of users) {
    if (u.user_name_enc) continue; // already encrypted

    const nameEnc = encryptPii(u.user_name);
    const emailEnc = encryptPii(u.user_email);
    const emailHash = hashForLookup(u.user_email);

    const bioEnc = encryptPii(u.user_bio);

    // Combine address fields into single JSON for encryption
    const addressData = {
      line1: u.user_address_line1,
      line2: u.user_address_line2,
      suburb: u.user_suburb,
      state: u.user_state,
      country: u.user_country,
      postcode: u.user_postcode,
    };
    const hasAddress = Object.values(addressData).some(Boolean);
    const addressEnc = hasAddress ? encryptPii(JSON.stringify(addressData)) : null;

    await sql`
      UPDATE "user" SET
        user_name_enc = ${nameEnc?.enc ?? null},
        user_name_iv = ${nameEnc?.iv ?? null},
        user_name_tag = ${nameEnc?.tag ?? null},
        user_email_enc = ${emailEnc?.enc ?? null},
        user_email_iv = ${emailEnc?.iv ?? null},
        user_email_tag = ${emailEnc?.tag ?? null},
        user_email_hash = ${emailHash},
        user_bio_enc = ${bioEnc?.enc ?? null},
        user_bio_iv = ${bioEnc?.iv ?? null},
        user_bio_tag = ${bioEnc?.tag ?? null},
        user_address_enc = ${addressEnc?.enc ?? null},
        user_address_iv = ${addressEnc?.iv ?? null},
        user_address_tag = ${addressEnc?.tag ?? null}
      WHERE user_id = ${u.user_id}
    `;
    userCount++;
  }
  console.log(`Encrypted PII for ${userCount} users.`);

  // -----------------------------------------------------------------------
  // 2. Encrypt organisation PII
  // -----------------------------------------------------------------------
  const orgs = await sql`
    SELECT organisation_id, organisation_name, organisation_email,
           organisation_address_line1, organisation_address_line2,
           organisation_suburb, organisation_state, organisation_country,
           organisation_postcode, org_name_enc
    FROM organisation
  `;

  let orgCount = 0;
  for (const o of orgs) {
    if (o.org_name_enc) continue;

    const nameEnc = encryptPii(o.organisation_name);
    const emailEnc = encryptPii(o.organisation_email);

    const addressData = {
      line1: o.organisation_address_line1,
      line2: o.organisation_address_line2,
      suburb: o.organisation_suburb,
      state: o.organisation_state,
      country: o.organisation_country,
      postcode: o.organisation_postcode,
    };
    const hasAddress = Object.values(addressData).some(Boolean);
    const addressEnc = hasAddress ? encryptPii(JSON.stringify(addressData)) : null;

    await sql`
      UPDATE organisation SET
        org_name_enc = ${nameEnc?.enc ?? null},
        org_name_iv = ${nameEnc?.iv ?? null},
        org_name_tag = ${nameEnc?.tag ?? null},
        org_email_enc = ${emailEnc?.enc ?? null},
        org_email_iv = ${emailEnc?.iv ?? null},
        org_email_tag = ${emailEnc?.tag ?? null},
        org_address_enc = ${addressEnc?.enc ?? null},
        org_address_iv = ${addressEnc?.iv ?? null},
        org_address_tag = ${addressEnc?.tag ?? null}
      WHERE organisation_id = ${o.organisation_id}
    `;
    orgCount++;
  }
  console.log(`Encrypted PII for ${orgCount} organisations.`);

  console.log("PII encryption complete!");
  await sql.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("PII encryption failed:", err);
  process.exit(1);
});
