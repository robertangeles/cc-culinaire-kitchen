-- sanitize-local.sql
--
-- Run ONLY against the LOCAL dev database, immediately after restoring a
-- production snapshot. It strips real customer PII and secrets so prod data
-- never lives in plaintext on a developer laptop, while keeping the snapshot
-- usable for local work.
--
-- Why login still works after this runs:
--   authService.login() matches on plaintext `user_email` (OR email-hash) and
--   verifies the password with bcrypt against `user_password_hash`. Neither
--   depends on the encryption keys, so clearing the encrypted PII triplets and
--   rotating to fresh local keys does not break sign-in.
--
-- Every user is given the SAME dev password so you can sign in as any user to
-- test roles. The lowest user_id is renamed to admin@local.test for convenience.
--   Dev password: DevPassword123!   (emails: dev<user_id>@local.test)
--
-- Usage (the bcrypt hash is passed in, never committed). Pass the RAW hash —
-- the script wraps it via :'devhash', so do NOT add your own quotes:
--   HASH="$(cd packages/server && node -e 'require("bcrypt").hash("DevPassword123!",12).then(h=>console.log(h))')"
--   psql "$LOCAL_DATABASE_URL" -v devhash="$HASH" -f packages/server/scripts/sanitize-local.sql

BEGIN;

-- 1) Session / token / secret tables: drop rows entirely (re-created on use).
DELETE FROM refresh_token;
DELETE FROM password_reset;
DELETE FROM email_verification;
DELETE FROM device_token;
DELETE FROM guest_session;
DELETE FROM credential;   -- encrypted integration secrets; re-enter via Settings -> Integrations

-- 2) Users: sanitize identity, clear encrypted PII, set a uniform dev password.
UPDATE "user" SET
  user_name              = 'Dev User ' || user_id,
  user_email             = 'dev' || user_id || '@local.test',
  user_password_hash     = :'devhash',
  mfa_enabled_ind        = false,
  mfa_secret             = NULL,
  user_bio               = NULL,
  user_address_line1     = NULL,
  user_address_line2     = NULL,
  user_suburb            = NULL,
  user_state             = NULL,
  user_country           = NULL,
  user_postcode          = NULL,
  user_facebook          = NULL,
  user_instagram         = NULL,
  user_tiktok            = NULL,
  user_pinterest         = NULL,
  user_linkedin          = NULL,
  stripe_customer_id     = NULL,
  stripe_subscription_id = NULL,
  -- Encrypted PII triplets + email hash: clear real ciphertext (unreadable under
  -- fresh local keys anyway). The app re-encrypts with local keys on next edit.
  user_name_enc = NULL,    user_name_iv = NULL,    user_name_tag = NULL,
  user_email_enc = NULL,   user_email_iv = NULL,   user_email_tag = NULL,
  user_email_hash = NULL,
  user_bio_enc = NULL,     user_bio_iv = NULL,     user_bio_tag = NULL,
  user_address_enc = NULL, user_address_iv = NULL, user_address_tag = NULL;

-- Convenience: lowest user_id becomes admin@local.test.
UPDATE "user" SET user_email = 'admin@local.test'
WHERE user_id = (SELECT min(user_id) FROM "user");

-- 3) Organisation PII (random suffix keeps any unique constraint satisfied).
UPDATE organisation SET
  organisation_email         = 'org-' || left(md5(random()::text), 8) || '@local.test',
  organisation_address_line1 = NULL,
  organisation_address_line2 = NULL,
  org_email_enc = NULL,   org_email_iv = NULL,   org_email_tag = NULL,
  org_address_enc = NULL, org_address_iv = NULL, org_address_tag = NULL;

-- 4) Store location PII.
UPDATE store_location SET
  address_line_1 = NULL,
  address_line_2 = NULL,
  location_address_enc = NULL, location_address_iv = NULL, location_address_tag = NULL;

-- 5) Supplier contact PII.
UPDATE supplier SET
  contact_email  = 'supplier-' || left(md5(random()::text), 8) || '@local.test',
  contact_phone  = NULL,
  address_line_1 = NULL,
  address_line_2 = NULL;

-- 6) Conversation guest tokens.
UPDATE conversation SET guest_session_token = NULL WHERE guest_session_token IS NOT NULL;

COMMIT;
