---
title: Staff Compliance Vault
category: entity
created: 2026-08-07
updated: 2026-09-20
related: [[compliance-expiry-engine]], [[document-storage-cloudinary-private]], [[scheduled-job-daily-claim]], [[store-locations-system]], [[tenant-isolation-remediation]], [[roster-core]]
---

Phase 1 of a three-phase plan: a private vault for staff and venue compliance documents (RSA, Food Safety Supervisor, police checks, Medicare cards, liquor licences), a manager verification queue, and an org-wide dashboard — built on `feature/ck-web/compliance-vault`.

## Why it exists

Venue operators track RSA and Food Safety Supervisor certificates by hand — email threads, camera rolls, filing cabinets — and nobody notices a lapse until an inspector asks. NSW RSA and FSS both run five-year cycles with no automatic renewal and no grace period. The vault gives an operator one screen to answer "is everyone current?" It deliberately stops there: deciding who can be rostered is Phase 2 — see [[roster-core]].

## Data model

| Table | Purpose |
|---|---|
| `compliance_document` | One row per certificate or identity document, held against a staff member OR a venue |
| `document_expiry_rule` | How long a document type stays valid per jurisdiction; effective-dated and versioned |
| `document_expiry_rule_alert_day` | Junction replacing a `renewal_alert_days` array — one row per (rule, days-before) |
| `document_access_log` | Every attempt to view a document's signed URL, granted or denied |
| `organisation_required_document` | The document types an org expects of every staff member, regardless of role |

### Tenancy

Every new table carries `organisation_id` (NOT NULL). `compliance_document` also carries a nullable `store_location_id`, matching the existing `order_guide` pattern: NULL means org-wide, a value means location-scoped. There is deliberately no separate `venue_id` column anywhere — `store_location` IS the venue. A second tenancy spine is exactly the bug class the July 2026 tenant-isolation audit spent 8 PRs closing (see [[tenant-isolation-remediation]]). Every service query derives `organisationId` from the authenticated user, never the client, and a cross-org document id reads as 404, not 403 — same reasoning as that audit's "don't let a guessed id confirm another tenant's data exists."

### Subject: person or venue, never both, never neither

A `compliance_document` row belongs to exactly one subject: a person (`user_id`) or a venue (`subject_store_location_id`). Two CHECK constraints enforce it:

```sql
-- Exactly one subject.
CHECK (num_nonnulls(user_id, subject_store_location_id) = 1)

-- A venue document's owning location IS its subject.
CHECK (
  subject_store_location_id IS NULL
  OR (store_location_id IS NOT NULL
      AND store_location_id = subject_store_location_id)
)
```

The second CHECK's `store_location_id IS NOT NULL` term is load-bearing, not decoration. Postgres only *violates* a CHECK when the expression evaluates to FALSE — it evaluates to NULL when any operand is NULL, and NULL **passes** a CHECK the same as TRUE. So `store_location_id = subject_store_location_id` alone would let a venue document through with `store_location_id` left NULL: `NULL = <uuid>` evaluates to NULL, not FALSE, and the constraint is satisfied. That is precisely the ambiguous-scope row this constraint exists to forbid — a venue's liquor licence filed under no venue at all. Adding the explicit `IS NOT NULL` term closes the hole. This was eng-review issue 3 on the plan, caught before it shipped rather than found later as a real orphaned row.

### Jurisdiction

`issuing_jurisdiction` on a document is where it was *issued* and is purely informational. Rule lookup and any future roster block use the **venue's** state instead, because that's whose regulator turns up for an inspection — a NSW RSA held by someone working a VIC venue is a real and legal situation, and the rule that matters is VIC's.

### Access logging

`document_access_log` records every `signedUrlForDocument` call, including denials — see [[document-storage-cloudinary-private]] for why the denied rows are the interesting ones.

## Services and routes

- `documentStorageService.ts` — Cloudinary private storage, magic-byte sniffing, signed URLs. See [[document-storage-cloudinary-private]] for the security reasoning; this is the most important file in Phase 1.
- `complianceService.ts` — verification workflow (`createDocument` / `verifyDocument` / `rejectDocument`), the org-wide dashboard aggregate, and the staff × required-document-type matrix. See [[compliance-expiry-engine]] for how status is computed and reconciled.
- `complianceExpiryMath.ts` / `complianceExpiryJob.ts` — the daily expiry scan. See [[compliance-expiry-engine]] and [[scheduled-job-daily-claim]].
- `routes/compliance.ts` — all routes under `authenticate`, gated by four permissions: `compliance:read-own` (view/upload/edit/delete your own documents), `compliance:read-all` (view all staff), `compliance:verify` (approve/reject), `compliance:manage-rules` (expiry rules + org document requirements). `/documents/mine` and `/documents/upload` are registered before `/documents/:id` so the parameterised route never swallows them. The upload route uses `multer.memoryStorage()` directly — never `middleware/upload.ts`'s `uploadFileBuffer` (see [[document-storage-cloudinary-private]]).
- `PUT`/`DELETE /api/compliance/documents/:id` — self-service edit and delete, added so a staff member can fix a typo'd certificate number or remove a mistaken upload without a manager. Same `compliance:read-own` gate as the rest of "my documents," with ownership decided inside `complianceService` (404, not 403, on a non-owner — same reasoning as `/documents/:id/view-url` below). Both are owner-only AND status-gated to Pending/Rejected only: once a document is Verified it's the record a manager signed off on, and `updateDocument`/`deleteDocument` refuse it server-side even if the client UI is bypassed. An edit on a Rejected document clears the rejection and resets it to Pending (the resubmit flow). Delete destroys the Cloudinary blob before the row, inside one transaction that row-locks against a concurrent `verifyDocument()`. Both routes sit behind the new `complianceDocumentEditRateLimit` (20/min per user) — a deliberately roomier limit than `complianceDocumentViewRateLimit` since `deleteDocument` holds a DB row lock for the duration of an external Cloudinary call, and an unlimited caller could burn the connection pool. `notes` is deliberately not editable through this route — it's manager-only free text about the staff member, not their own certificate metadata.
- `/documents/:id/view-url` is gated by the broadest OR of every permission that could legitimately reach it (`read-own`, `read-all`, `verify`), because the route itself doesn't decide access — `complianceService.isOwnDocument` does, checked inside the handler. The permission proves "you can read documents you own," not "you may read *this* document id" — without the ownership check, `compliance:read-own` alone would let a staff member view a colleague's document by guessing a UUID. `handleGetDocumentViewUrl` also refuses an Archived document outright, regardless of ownership or permission — access to an offboarded staff member's file is meant to stop the day they leave, not seven years later when retention finally purges it (see `complianceRetentionService.archiveForUser`).
- `POST /documents/venue` (`compliance:verify`) creates a document whose subject is a venue, not a staff member (a liquor licence, a food registration) — `handleCreateVenueDocument` forces `userId: null` and takes the venue id only from `subjectStoreLocationId`, never trusting a client-supplied staff subject. `createDocument` enforces exactly one of `userId`/`subjectStoreLocationId` at the service layer too, so this isn't a controller-only guarantee.
- `POST /documents/:id/nudge` (`compliance:read-own`) is the staff-side "still waiting on you" reminder (CV-C7): usable once a Pending document has waited 48h (`NUDGE_ELIGIBLE_AFTER_HOURS`, shared via `@culinaire/shared` so the server enforcement and the client's button/badge thresholds can't drift apart), throttled to one nudge per 24h. The throttle's check-then-insert runs inside a transaction that row-locks the document first, closing a race where two concurrent nudges could both slip past the "already nudged" check and double-notify every verifier.

## Client

As of the information-architecture rework (PR #99), the compliance surfaces are no longer one page — each lives where its audience actually looks for it, though the four underlying permissions and their `routes/compliance.ts` gates are unchanged:

- **Team Compliance** — `CompliancePage.tsx` at `/compliance`, renamed from "Compliance". Now a two-tab shell: Team (`ComplianceDashboard`, needs `read-all`) and Verify (`VerificationView`, needs `verify`). A component is only ever mounted if the user holds the permission its endpoint needs, so a user without `compliance:read-all` never even fetches the team dashboard and never sees a 403. The route guard (`App.tsx`) and nav gate (`navConfig.ts`) are both narrowed to `read-all` / `verify` only, kept deliberately in step with each other; a user holding only `read-own` or only `manage-rules` gets no nav entry and, if they hit the URL directly, the page's own "nothing to show" fallback rather than a dead single-tab shell.
- **My Documents** — moved to `ProfilePage.tsx`'s new "My Documents" tab, gated on `compliance:read-own`; still `MyDocumentsTab.tsx` underneath (which composes `MyDocumentsList.tsx` + `DocumentUploadForm.tsx`). The profile container widened `max-w-2xl` → `max-w-[52.5rem]` (672px → 840px) to give the document list room. `MyDocumentsList.tsx` now has three per-row actions: view (read-only panel — file preview plus the fields that came with it), and, on Pending/Rejected rows only, edit (inline form, reusing `documentFormShared.ts`) and delete (confirm dialog). Verified rows show view only, matching the server-side status guard. A Pending row waiting 48h+ also grows a nudge button (`NudgeButton`, CV-C7) that calls `POST /documents/:id/nudge`. `DocumentUploadForm.tsx` now also captures engagement type (employee/contractor/agency, CV-F1) at upload time.
- **Requirements** — moved to the Settings page's new "Compliance" tab (`SettingsLayout.tsx`'s tab registry gates it on `compliance:manage-rules`), still `RequiredDocumentsTab.tsx` underneath, unchanged apart from `p-6`/`m-6` added across its loading/error/ready states — it was built for the old Compliance page's own padded container, which Settings' wrapper doesn't supply. The same Settings → Compliance tab group now also has "Document Expiry Rules" (`ComplianceRulesTab.tsx`) and, under Settings → Roster, "Award Rules" (`AwardRulesTab.tsx`) — both Administrator-only, both sharing drawer-open state via `useRuleDrawer.ts`.
- **Verify queue** — `VerificationView.tsx`'s waiting-time badge now colors red once a document crosses the same 48h nudge threshold the staff side offers at (`WaitingBadge`), and gained a "+ Add venue document" affordance (`VenueDocumentForm.tsx`) for a manager to file a venue-subject document (liquor licence, food registration) directly, without a staff member in the loop.

## Known limits

Stated plainly, not softened into "future enhancements":

- **Phase 2 (rostering) is built — see [[roster-core]].** The award-rule-owner blocker was resolved by shipping the Award engine machinery with zero `award_rule` rows seeded and the coverage gap explicitly disclosed on every publish, rather than waiting on an IR-competent reviewer to be named. That naming is still open, tracked as a P2 follow-on, not a ship-blocker.
- **The expiry-rule editor now has an admin UI (`feature/ck-web/org-admin-rule-editors`).** Settings → Compliance's new "Document Expiry Rules" tab (`ComplianceRulesTab.tsx`) calls `GET`/`PUT /api/compliance/rules`, double-gated on `compliance:manage-rules` + `requireAdministrator()`. Editing a rule closes the current version and opens a new one (`upsertExpiryRule`, same partial-unique-index + retry-once-on-conflict pattern as `award_rule`, now shared via `utils/retryOnConflict.ts`) rather than mutating history in place, so a roster published under the old rule still sees the rule that applied at the time.
- **Document preview and the real upload write are unverified pending Cloudinary credentials.** `documentStorageService.test.ts` mocks the `cloudinary` module entirely, so the test suite proves the code's *logic* (magic-byte sniffing, hard-fail on missing credentials, TTL, access logging) but has never exercised a real upload or a real signed-URL fetch against a live Cloudinary account. That first real call is still owed before this ships to a pilot org.

## Related
[[compliance-expiry-engine]] · [[document-storage-cloudinary-private]] · [[scheduled-job-daily-claim]] · [[store-locations-system]] · [[tenant-isolation-remediation]] · [[roster-core]]
