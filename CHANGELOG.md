# Changelog

All notable changes to CulinAIre Kitchen are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Offsite database backup.** A daily dump of prod is checked, encrypted (AES256) and uploaded to Google Drive, and uploads older than 30 days are removed. Until now every backup lived only on one laptop. `scripts/backup/prodOffsiteBackup.sh`; setup, health check and restore steps in `docs/architecture/offsite-backup.md`.
- **Delete my account.** Profile -> Security now has a "Delete account" section. The user confirms with their password (Google-only accounts type their email; accounts with MFA also enter their authenticator code), the account is anonymised exactly like an admin deletion, and they are signed out. Google-only accounts must also have signed in within the last 10 minutes. Blocked, with a clear message, for the only Administrator and for the only admin of an organisation that still has other members. `POST /api/users/delete-account`, `accountDeletionService.ts`. The profile response now includes `hasPassword`.

### Changed

- **Deleting a user now anonymises the account instead of removing the row.** Personal data (conversations, credentials, roles, notifications, saved recipes, preferences) is removed, the name, email and other identity fields are scrubbed, any Stripe subscription is cancelled immediately, and the user row is kept so orders, waste logs and the audit trail stay valid with no name attached. Previously the hard delete failed for any user with business history and left orphan rows (for example notifications) behind for the rest. Deleted users are hidden from the admin user list. `userAnonymisationService.ts`; the admin confirmation text now says what actually happens.

### Fixed

- **Deleting an account now also deletes the Stripe customer and the profile photo file.** Deletion cancelled the subscription and cleared the photo's address from the account, but Stripe kept the customer's name and email, and the uploaded photo stayed public at its Cloudinary link. The customer is now deleted after the subscription is cancelled (Stripe keeps its invoices and payment records); if Stripe refuses, the account is not deleted and the user can retry. The photo is removed from Cloudinary on a best-effort basis: a failure is logged with the link and the deletion goes on. Only photos we uploaded to the avatar folder are ever removed, never a Google avatar or a link another account also uses, because the photo address is user-editable. A local `/uploads/` photo (the no-Cloudinary dev fallback) is not removed from disk. `anonymiseUser`, `stripeService.deleteCustomer`, `deleteProfilePhoto`.
- **Guessing two-factor codes and passwords is now capped per account, not just per address.** The MFA routes shared the sign-in limit of 20 attempts a minute per address, so an attacker using many addresses was not stopped, and a busy kitchen's MFA sign-ins used up the same budget as everyone's logins. `/api/auth/mfa/verify` now has its own per-address limit (20 failed codes a minute) and every MFA route (`/setup`, `/enable`, `/disable`, `/verify`) allows 5 failed attempts per account per 15 minutes, answered with `429`. Only failures count, so successful sign-ins never use up the budget, and neither does the `409` that setup returns while MFA is already on (no password or code was checked). The account is taken from the session, or on `/mfa/verify` from a verified MFA session token; a forged token names no account and cannot be aimed at someone else. The counters are in memory, so a deploy resets them. Change-password and delete-account still use the per-address limit. New: `mfaVerifyRateLimit` and `mfaAccountRateLimit` in `middleware/rateLimiter.ts`, a database-free unit test for the MFA proof check (`services/mfaProof.test.ts`).
- **Changing your password now ends your other sign-ins, and guessing your current password is slowed.** The change-password route had no rate limit, so someone holding a stolen session could keep guessing the current password; it now shares the sign-in limit of 20 attempts a minute per address. That slows guessing without capping it per account, so an attacker using many addresses is not stopped yet. A password change also left every other sign-in alive, unlike a password reset. It now ends all other refresh tokens and keeps the one you are using (the `refresh_token` cookie, or `refreshToken` in the body for bearer clients; with neither, all end). A device that is already signed in stays usable until its current access token expires (up to an hour). The password update and the sign-out are one transaction, and server faults are no longer returned to the client as a 400 with their raw text. `POST /api/users/change-password`.
- **The MFA login code step is now rate limited.** Entering the authenticator code at sign-in had no limit at all, so someone who had just passed the password step could try codes as fast as they liked for the five minutes the step stays open. It now shares the sign-in limit of 20 attempts a minute per address. That slows guessing without capping it per sign-in, so an attacker using many addresses is not stopped yet. `POST /api/auth/mfa/verify`.
- **Uploading a PDF to the compliance vault no longer stalls for five seconds.** The certificate reader (OCR) only understands images, so a PDF sat through its full timeout and came back empty every time. PDFs now skip it and go straight to the manual-entry form; JPEG and PNG uploads are read as before.
- **Two-factor settings can no longer be changed with just a session.** Anyone holding a stolen session could start MFA setup, which replaced the authenticator secret even when MFA was already on (locking the owner out), or switch MFA off with no check at all. Starting setup now needs the account password (Google-only accounts: a sign-in within the last 10 minutes), setup is refused while MFA is on, and switching MFA off needs the password plus a current authenticator code. The three MFA routes are rate limited. The Security tab asks for what the server requires. `POST /api/auth/mfa/setup` and `/disable` now take `{ password, mfaCode }`; an API client that called them with an empty body gets 403.
- **`/settings`, `/profile` and `/my-shelf` no longer render for a visitor with no session.** `AuthenticatedOnly` only redirected guests, so when the guest session could not start (rate limit or guest cap) the visitor was neither guest nor authenticated and saw the Settings admin shell. The server still returned 401 for all data. It now redirects anyone who is not authenticated to `/chat/new`.
- **Global `/api` rate limit no longer locks signed-in users out.** The old per-IP 60/min limit broke the UI after about four page loads (a page load costs ~15 requests) and made everyone behind one office/NAT IP share a single budget. Signed-in users are now limited per user id at 300/min (override with `RATE_LIMIT_PER_MINUTE`). Anonymous traffic, and requests with a forged or expired token, stay on the per-IP 60/min bucket. `/api/auth/*` remains exempt. New: `packages/server/src/middleware/globalRateLimit.ts`.

---

## [0.1.0] — 2026-10-01 (Phase 5)

### Changed

- **Scheduler extracted from `index.ts` into `scheduler.ts`.** All background job logic (~253 lines) — 10 jobs, the `isProductionProcess` gate, and graceful shutdown — moved to `packages/server/src/scheduler.ts`. `index.ts` shrinks from 684 to 431 lines. No runtime behaviour changed; the scheduler is called via `startScheduler(log)` which returns a `clearAll()` cleanup function used in the SIGINT/SIGTERM handlers.

---

## [0.1.0] — 2026-10-01

### Fixed

- **Recipe refinements now use knowledge base context.** `recipeRefinementService` was reading `.text`/`.content` from search results — fields that don't exist on `SearchResult`. The field is `.snippet`. RAG context was silently empty on every recipe refinement call; it now contains the relevant knowledge base snippets.
- **Subscription period end dates populate across all Stripe API versions.** Stripe SDK v20 moved `current_period_end` to `SubscriptionItem`; accounts on older API versions still return it at the subscription level. Both locations are now checked so subscription display is correct regardless of account API version.
- **E2E test selectors repaired** after guide panel and networkidle changes introduced stale selectors in `purchasing.spec.ts` and `order-guides.spec.ts`.

### Changed

- **TypeScript `no-explicit-any` enforced** on all production server code. 238 explicit `any` usages replaced with concrete types, `catch (err: unknown)` guards, or minimal type assertions. ESLint `@typescript-eslint/no-explicit-any: error` added to production config (test files remain exempt).
- **Catch handlers now return `String(err)`** for non-Error thrown values instead of `undefined`. All 36 server catch blocks use `err instanceof Error ? err.message : String(err)` pattern.
