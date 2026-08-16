---
title: Staff Compliance Vault
category: entity
created: 2026-08-07
updated: 2026-08-16
related: [[compliance-expiry-engine]], [[document-storage-cloudinary-private]], [[scheduled-job-daily-claim]], [[store-locations-system]], [[tenant-isolation-remediation]]
---

Phase 1 of a three-phase plan: a private vault for staff and venue compliance documents (RSA, Food Safety Supervisor, police checks, Medicare cards, liquor licences), a manager verification queue, and an org-wide dashboard — built on `feature/ck-web/compliance-vault`, no rostering yet.

## Why it exists

Venue operators track RSA and Food Safety Supervisor certificates by hand — email threads, camera rolls, filing cabinets — and nobody notices a lapse until an inspector asks. NSW RSA and FSS both run five-year cycles with no automatic renewal and no grace period. The vault gives an operator one screen to answer "is everyone current?" It deliberately stops there: it does not decide who can be rostered (that's Phase 2, and it is blocked — see Known limits).

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
- `routes/compliance.ts` — all routes under `authenticate`, gated by four permissions: `compliance:read-own` (view/upload your own documents), `compliance:read-all` (view all staff), `compliance:verify` (approve/reject), `compliance:manage-rules` (expiry rules + org document requirements). `/documents/mine` and `/documents/upload` are registered before `/documents/:id` so the parameterised route never swallows them. The upload route uses `multer.memoryStorage()` directly — never `middleware/upload.ts`'s `uploadFileBuffer` (see [[document-storage-cloudinary-private]]).
- `/documents/:id/view-url` is gated by the broadest OR of every permission that could legitimately reach it (`read-own`, `read-all`, `verify`), because the route itself doesn't decide access — `complianceService.isOwnDocument` does, checked inside the handler. The permission proves "you can read documents you own," not "you may read *this* document id" — without the ownership check, `compliance:read-own` alone would let a staff member view a colleague's document by guessing a UUID.

## Client

As of the information-architecture rework (PR #99), the compliance surfaces are no longer one page — each lives where its audience actually looks for it, though the four underlying permissions and their `routes/compliance.ts` gates are unchanged:

- **Team Compliance** — `CompliancePage.tsx` at `/compliance`, renamed from "Compliance". Now a two-tab shell: Team (`ComplianceDashboard`, needs `read-all`) and Verify (`VerificationView`, needs `verify`). A component is only ever mounted if the user holds the permission its endpoint needs, so a user without `compliance:read-all` never even fetches the team dashboard and never sees a 403. The route guard (`App.tsx`) and nav gate (`navConfig.ts`) are both narrowed to `read-all` / `verify` only, kept deliberately in step with each other; a user holding only `read-own` or only `manage-rules` gets no nav entry and, if they hit the URL directly, the page's own "nothing to show" fallback rather than a dead single-tab shell.
- **My Documents** — moved to `ProfilePage.tsx`'s new "My Documents" tab, gated on `compliance:read-own`; still `MyDocumentsTab.tsx` underneath, unchanged. The profile container widened `max-w-2xl` → `max-w-[52.5rem]` (672px → 840px) to give the document list room.
- **Requirements** — moved to the Settings page's new "Compliance" tab (`SettingsLayout.tsx`'s tab registry gates it on `compliance:manage-rules`), still `RequiredDocumentsTab.tsx` underneath, unchanged apart from `p-6`/`m-6` added across its loading/error/ready states — it was built for the old Compliance page's own padded container, which Settings' wrapper doesn't supply.

## Known limits

Stated plainly, not softened into "future enhancements":

- **Phase 2 (rostering) is blocked, not merely unbuilt.** The gate that would stop assigning someone to a shift when their RSA has lapsed depends on `award_rule` rows (Fair Work Award interpretation), and nobody on this project is currently named as competent to author them. MA000009 changes several times a year — 1 July wage reviews, FWC variations, casual-conversion and loading changes — and getting it right needs industrial-relations competence, not calendar diligence. This is tracked as a P1 backlog item that explicitly blocks the Phase 2 ship, separate from and harder than the holiday-calendar upkeep (which is clerical and low-risk).
- **No admin UI exists yet for the expiry-rule editor.** `GET`/`PUT /api/compliance/rules` are live and permission-gated (`compliance:manage-rules`), but there is no client screen that calls them — `RequiredDocumentsTab.tsx` only manages *which document types an org requires* (`organisation_required_document`), not the rules that say how long each type stays valid or what days to alert on (`document_expiry_rule`). Until a rules screen exists, seeding and editing expiry rules is a server-side/SQL operation.
- **Document preview and the real upload write are unverified pending Cloudinary credentials.** `documentStorageService.test.ts` mocks the `cloudinary` module entirely, so the test suite proves the code's *logic* (magic-byte sniffing, hard-fail on missing credentials, TTL, access logging) but has never exercised a real upload or a real signed-URL fetch against a live Cloudinary account. That first real call is still owed before this ships to a pilot org.

## Related
[[compliance-expiry-engine]] · [[document-storage-cloudinary-private]] · [[scheduled-job-daily-claim]] · [[store-locations-system]] · [[tenant-isolation-remediation]]
