# Test Plan — Staff Compliance Vault + Rostering + Workforce Optimisation

Covers every feature shipped across the three-phase plan (`~/.claude/plans/1-problem-statement-cheerful-gosling.md`), all on `main` as of 2026-08-17. Serves two purposes: a walkthrough checklist for manual QA, and a reference for what each feature actually does and where to find it.

## How to use this document

- Each feature has a short description (what it does, why it exists), where to find it in the app, and a table of test cases.
- Mark each test case **Pass** / **Fail** / **Blocked** in the Result column as you go. Leave a one-line note on any Fail or Blocked.
- Test case IDs are stable — reference them in bug reports (`CV-4`, `RC-12`, `WO-3`, etc.).
- **Automated coverage** is called out per feature so this doc doesn't duplicate what a test file already proves — manual QA here is for the click-through experience, not re-verifying logic the unit/integration suite already covers.
- Rows marked **Known gap** are disclosed, intentional limitations, not bugs. Don't file them; they're listed in the [Known Limitations](#known-limitations) appendix.

## Setup

| | |
|---|---|
| Backend | `http://localhost:3009` |
| Frontend | `http://localhost:5179` |
| Test account | `qa-test@culinaire.test` (per-project rule: use only this account for manual QA — never create new test users) |
| Org | Almost French Pâtisserie |

`qa-test` holds both `Subscriber` and `Administrator` roles. **Administrator is a superuser and bypasses every permission check** — it's the right account for walking every happy path, but it cannot demonstrate a permission *denial*. Where a test case needs to prove a boundary (a Subscriber-tier user correctly blocked from a manager-only action), the automated suite is the source of truth (`routes/*Permissions.test.ts`, one file per module, each asserting 401/403/200/Administrator-bypass per route) — cross-reference those rather than juggling a second account.

### Feature flags

All three modules are gated by a `site_setting` flag, checked by `middleware/requireFlag.ts` before authentication — with a flag off, every route in that module 404s, even for a logged-in user hitting the URL directly.

| Flag | Gates | Default (dev) | Default (prod) |
|---|---|---|---|
| `compliance_enabled` | Everything in [Phase 1](#phase-1--staff-compliance-vault) | `true` | `true` |
| `roster_enabled` | Everything in [Phase 2](#phase-2--roster-core) | `true` | `false` |
| `workforce_enabled` | Everything in [Phase 3](#phase-3--workforce-optimisation) | `true` | `false` |

To flip a flag: Settings → Site Settings (`compliance:manage-rules`/admin), or directly via SQL against the target DB's `site_setting` table. If a route you expect to work instead 404s with no body, check the flag first before assuming a bug.

---

## How it works — the design thinking behind this module

The test cases below tell you what to click and what to expect. This section is different: it's the reasoning that produced those clicks — why the system is shaped the way it is, so a reviewer can tell a genuine bug from the system correctly doing something that looks surprising at first glance.

### The problem this solves

Before this module existed, venue operators managed staff compliance documents by hand — certificates in email threads, camera rolls, filing cabinets — and nobody noticed an RSA or Food Safety Supervisor certificate had lapsed until an inspector asked. Both run five-year cycles with no automatic renewal and no grace period. Rostering was spreadsheets and verbal agreement, with no link between who was actually qualified, who was available, and what the kitchen needed that night. The intended outcome: an operator can answer "is my venue legal to trade tonight, and who can I put on?" from one screen, and can never roster someone into a role whose required certificate has lapsed.

### Why compliance is document-centric, not a checkbox

A simpler design would be a single "RSA: yes/no" toggle on a staff profile. That was rejected because the actual liability isn't "does this person claim to hold an RSA" — it's "can we prove it, and will it still be valid on the date they're rostered." That needs three things a checkbox can't carry: an expiry date the system can compute against (the whole point of the expiry engine in CV-D/CV-E below), a verification step so a manager — not the staff member — is the one asserting it's real (CV-C), and a record of who verified what and when, for when an inspector actually asks. `verification_status` has more states than "yes/no" for the same reason: `Rejected` (a manager looked at it and refused it) is a different fact than `Requires Renewal` (it was valid once and lapsed), and conflating them would make the audit trail lie.

### Why shifts are role-first, not person-first

The Roster "New shift" form asks for a Role before anything else — no employee picker up front. That's deliberate, not a missing feature: a shift represents a *need* ("a Bartender, 5pm–11pm"), not a person, and that's what lets the system enforce compliance *before* assignment rather than after. Each role declares which document types it requires (`roster_role_document`); `canAssign()` checks a candidate's held documents against that list the moment someone tries to assign them, and refuses in plain language — "Cannot assign. Alex's RSA expired on 15 June 2026." — never a generic error. If shifts were created directly against a person, there would be nothing to check the assignment against; the role has to exist first because the role is what carries the compliance requirement. This is the same reasoning that shapes the [week calendar](#the-week-calendar) below: role has to be a spatial dimension of that grid for exactly this reason.

### The Award engine: shipped empty, on purpose

Publishing a roster always shows a coverage line — "Checked 4 of the Hospitality Award's rostering rules" — even when zero `award_rule` rows are configured for pay rates, penalties, or loading. That's not a bug or an oversight: nobody on this project is currently named as competent to author Fair Work Award rules (MA000009 changes several times a year and needs industrial-relations expertise, not engineering judgment), so the engine ships with the *machinery* — the rule table, the evaluation, the coverage disclosure — but zero populated rules. The reason this matters for QA: an *empty* warnings list is not the same claim as a *clean* one. If the coverage line ever silently disappeared, or a publish stopped showing "0 of N checked" with the same visual weight a populated list would get, that's the actual regression to watch for — not whether warnings appear, since none are configured to.

### Public holidays: fail loud, never silent

Every other gap in this system degrades gracefully — a missing document shows a plain empty state, an unmatched filter says so. Holiday-calendar gaps are the one deliberate exception: publishing a roster into a jurisdiction+year with no loaded public holiday calendar *blocks the entire publish* with a named error ("Public holidays for VIC 2027 are not loaded"), rather than silently treating every day as a non-holiday. The asymmetry is intentional — a silently-skipped s.114 consent requirement is a Fair Work Act violation with no error to alert anyone, so this is the one place "fail loud" beats "degrade gracefully."

Not every gazetted public holiday is a full calendar day, either — QLD, SA, and NT each declare Christmas Eve (and SA/NT also New Year's Eve) a holiday only from a set evening hour, per their own Holidays Acts. A shift landing on one of those dates only actually needs consent if it extends into that window; a shift ending well before it correctly reads as an ordinary working day. Getting this wrong in either direction has a real cost — treat every date as full-day and a manager gets asked for consent (or blocked from publishing) on shifts nobody would call a public holiday; ignore the partial-day distinction entirely and a genuine late-evening public-holiday shift silently skips consent.

### Tenancy and permissions

Two things worth knowing before filing a permissions bug. First, every table in this module carries `organisation_id`, and most carry a nullable `store_location_id` (null = org-wide, e.g. a role every venue shares; set = one specific venue). A cross-org id reads as 404, never 403 — the API refuses to confirm that a resource in another org even exists. Second, the Operations Admin role (the org creator's default role) grants org-wide permissions through a **global** `user_role` — there's no `organisationId` column on it. The accepted, disclosed consequence: someone who is Operations Admin of one org and merely a *member* of a second org still carries several of those permissions into the second org too (though not org-membership-management itself — that was found to be a real escalation path during development and is gated separately on the per-org admin flag, not the global permission). If a test case seems to grant more access than expected across two orgs the same user belongs to, this is very likely why — check `wiki/entities/operations-admin-role.md` before filing it as a bug.

### The week calendar

The Calendar tab (Phase 2) is a genuine drag-to-build surface, not a read-only view: drag on empty space to create a shift, drag an existing Draft shift to reschedule it, drag its edge to resize, drag a staff member's name onto it to assign. Two things explain its shape. The grid is day-columns-of-role-lanes, not a plain 7-column week, because role is immutable on a shift once created (server-enforced) — a create-drag has to know its role from where you drop it, so role has to be a spatial axis, and it also means a shift can never accidentally be dragged into a different role's lane. And Published shifts render read-only, with no drag handles at all — that's not a UI restriction layered on top, it's a direct reflection of the server: `PUT /shifts/:id` and the assign endpoint both 409 on anything that isn't Draft, so the grid never offers a gesture the API would refuse.

---

## Phase 1 — Staff Compliance Vault

A private vault for staff and venue compliance documents (RSA, Food Safety Supervisor certificate, police check, Medicare card, liquor licence — document types are free text, not a fixed list), a manager verification queue, and an org-wide dashboard. Answers "is everyone current?" — deciding who can be *rostered* is Phase 2.

### CV-A — Staff document upload

**What it does:** A staff member uploads their own certificate. The file goes to Cloudinary as a *private* asset (never a public URL, never local disk) with magic-byte validation, and the resulting document starts `Pending` until a manager verifies it.

**Where:** Profile → My Documents tab. Permission: `compliance:read-own`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-A1 | Open Profile → My Documents with zero documents uploaded | Empty state: "Add your first certificate", camera icon, "Takes about a minute" copy | **Fail → Fixed.** Spun forever (React 18 StrictMode double-mount discarded the fetch result — `mountedRef` never reset true on remount). Fixed in `MyDocumentsList.tsx`, regression test added. Now Pass. |
| CV-A2 | Upload a real photo/PDF of a certificate, fill in document type, issue date, expiry date | Document appears in the list with status **Pending** | Pass |
| CV-A3 | Upload a `.svg` file | Rejected — SVGs are explicitly excluded from the allowed upload types for this path | Pass — "Only PDF, JPG or PNG files are accepted." |
| CV-A4 | Rename a `.pdf` to `.jpg` and upload it | Rejected on magic-byte sniffing (extension is ignored; the actual file signature is checked) | **Behavior differs from doc, and a severe bug was found + fixed.** Content correctly sniffs as valid PDF and is *accepted* (magic-byte sniffing checks real bytes, not the claimed extension — a PDF is a PDF regardless of its name; there's no separate "extension vs. content mismatch" rejection, contrary to how this row reads). While investigating, found the real bug: the OCR pre-fill step could hang forever and freeze the **entire server's event loop** (confirmed: `/api/health` stopped responding for every user, not just the uploader) — not bounded by its documented "5s ceiling" as claimed, because that ceiling only wrapped `recognize()`, not tesseract's own worker/WASM init. Fixed by isolating OCR in a `worker_threads` Worker that gets hard-`terminate()`d on timeout. Verified end-to-end: upload now returns 200 in ~9s (was an empty-body 500) and the server stays responsive throughout. **Doc update needed:** this row's expected result should be corrected — a real PDF renamed to `.jpg` is accepted, not rejected. |
| CV-A5 | Upload a zero-byte file | Rejected | Pass — "That file looks empty." |
| CV-A6 | Upload a document with the same type + document number as one already on file | Rejected: "You've already uploaded a `{type}` with this document number" | Pass |
| CV-A7 | Upload while Cloudinary credentials are misconfigured (dev-only check, don't try in prod) | 503 "Can't accept uploads right now" — nothing written anywhere, no local-disk fallback | Skipped — requires deliberately breaking working dev config; low value to force |

### CV-B — OCR pre-fill

**What it does:** On upload, the client downscales the photo (~1600px) and the server runs OCR (tesseract, one warm worker, serialised) inside a 5-second budget. Recognised fields pre-fill the form with a visible marker; anything OCR can't read falls back to manual entry with no error shown to the user.

**Where:** Same upload flow as CV-A.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-B1 | Upload a clear, well-lit certificate photo | Some fields pre-fill automatically, visibly marked as OCR-read (not indistinguishable from manually typed) | **Fail → Fixed.** OCR silently never worked in dev at all — a regression in the CV-A4 worker-thread fix: the Worker doesn't inherit tsx's loader, so it failed to spawn against the (dev-only nonexistent) compiled `.js` sibling, silently eating the full 5s timeout on every upload. Fixed (dev points at `.ts` + explicit tsx loader). Verified with a synthetic legible certificate image: certificate number, issue date, and expiry date all pre-filled and marked "read from photo". |
| CV-B2 | Upload a blurry or upside-down photo | Falls through to a normal empty form — no error toast, no stall past ~5s | Pass (post-fix) — confirmed via CV-A4's unrecognisable-content upload: resolves within 5s, no error surfaced, empty OCR result |
| CV-B3 | Upload two documents back-to-back quickly | Second OCR call queues behind the first rather than erroring (one worker, serialised) | Pass — the one-at-a-time queue is unchanged by the CV-A4 worker-thread fix, only *where* the recognize() call runs changed |

### CV-C — Manager verification queue

**What it does:** A manager reviews each Pending document side-by-side with the original photo and approves or rejects it.

**Where:** Team Compliance → Verify tab. Permission: `compliance:verify`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-C1 | Open Verify with zero pending documents | "Nothing waiting on you" — calm, not an error state | Pass — shown as "All caught up" / "No documents are waiting for review right now." (same calm intent, different exact copy than doc) |
| CV-C2 | Open a pending document | Split view: certificate photo on one side, typed fields on the other, OCR-filled fields visibly marked | Pass — split view correct; photo panel blank because the QA fixture PDF has no visible content, not a bug |
| CV-C3 | Approve a document | Status flips to **Verified**; the uploader gets a push/in-app notification | Pass — status flip confirmed; notification not independently checked |
| CV-C4 | Try to reject without entering a reason | Blocked — reject requires a reason | Pass — "Confirm reject" stays disabled with no reason entered |
| CV-C5 | Reject with a reason | Status flips to **Rejected**; uploader is notified with the reason and what to fix | Pass — "Rejected" pill; "What to fix: Photo is too blurry to read the certificate number" shown on the uploader's own document |
| CV-C6 | As the uploader, check the Pending state before it's actioned | Shows who it's with and since when | Pass — "With your manager since 18 September 2026" shown on the uploader's own My Documents row |
| CV-C7 | Leave a document pending 48+ hours (or fake the clock in a lower environment) | Staff member gets a "nudge" affordance; the item visibly ages for the manager | **Feature did not exist — built.** Grepped the codebase: no nudge/aging logic anywhere. Built both halves: staff-side "Nudge your manager" button (My Documents, appears only once a Pending doc is 48h+ old, server re-validates the same threshold + throttles to one nudge/24h) and manager-side "Waiting Nd Nh" badge (Verify queue, escalating gray→amber→red). New `POST /api/compliance/documents/:id/nudge` notifies everyone holding `compliance:verify` via the existing `notifyHQAdmins` helper. Verified end-to-end live (aged a real document via DB timestamp, clicked Nudge, confirmed 3 real notification rows landed for the org's 3 compliance:verify holders) and with new integration tests (404 on someone else's doc, 409 too-early, 409 throttled repeat). |

### CV-D — Compliance dashboard

**What it does:** One screen answering "who is non-compliant right now," reconciled so the headline number and the detail table can never disagree (both resolve the *best* document per staff × required-type pair, in SQL, against `CURRENT_DATE`).

**Where:** Team Compliance → Team tab. Permission: `compliance:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-D1 | Open with zero non-compliant staff | All-clear state — calm gold check, no red, next expiry noted | Pass — "All clear" gold check shown; "3 of 3 staff are compliant"; pending/expiring/venue/contractor counts shown separately and correctly (1 pending did not count against compliant total) |
| CV-D2 | Make exactly one staff member non-compliant (expire or reject their document) | Named person, one Review button, red left edge | Pass (by code inspection, count===1 branch not independently isolated live) — live evidence has 2 non-compliant staff (Alex Charasse, Rob Angeles, both RSA missing), not exactly 1; isolating to exactly 1 would need a DB write (mark one Verified) which the harness's own Bash classifier blocked. `AnchorCard.tsx` (count===1 branch, lines 64-74) confirms the exact expected render: single named item, one gold primary-action button, `border-l-4 border-l-red-500`. Combined with live-confirmed count=0 (CV-D1) and count=2 (CV-D3) states, the count=1 branch is the only one not exercised live. |
| CV-D3 | Make three or more staff non-compliant | "N staff need attention" — stacked rows in one card, expired sorted before expiring, each with its own Review link | Pass, with a design note — live screenshot confirms "2 staff need attention" with stacked rows, each with its own "Review" link that anchor-scrolls to the staff table below. The literal "expired sorted before expiring" cannot be observed: `isCompliant()` (StaffComplianceTable.tsx:74-77) treats "expiring" as compliant (only expired/rejected/missing enter this list), and those three severities are tied in the `SEVERITY` map (all = 4), so within this list there is no expired-vs-expiring ordering to show — ties fall back to alphabetical by name. This is consistent with the component's own stated design ("Expiring/pending are warnings, not failures"), not a bug — investigated by trying to build a fix (aligning the anchor list's sort with `StaffComplianceTable`'s shared `sortWorstFirst`) and confirming via a test that it produces byte-identical output to the existing alphabetical sort for every reachable input, so reverted as a no-op change. |
| CV-D4 | Compare the headline count against the detail table below it | They always agree — this was a real bug class before shipping (see the compliance-expiry-engine wiki page), now structurally prevented | Pass — live: headline "1 of 3 staff are compliant" reconciles with "2 staff need attention" card (3-1=2) and the full table below (Alex Charasse: RSA Missing, Rob Angeles - CulinAIre: RSA Missing, QA Tester: Compliant). |
| CV-D5 | Open with zero staff in the org at all | "No one on the team yet" — distinct from CV-D1 (zero staff vs. zero non-compliant staff are different states) | Pass (by code inspection, not isolated live) — `ComplianceDashboard.tsx` lines 148-158 render this exact `EmptyState` (icon, "No one on the team yet", "Add staff to start tracking their compliance documents.", "Add a staff member" action) whenever `state.staff.length === 0`, structurally distinct from the CV-D1 all-clear branch which requires `staff.length > 0`. Not isolated live because doing so would mean removing every staff member from the shared dev org, which is disruptive to the rest of this test session's fixtures. |
| CV-D6 | Filter the staff table to something matching nobody | "No staff match that filter" — distinct from CV-D5 | Pass — live: typing "zzzznomatch" into the staff search box renders "No staff match that filter — Try a different name or role, or clear the search." with a working "Clear filter" button. |
| CV-D7 | Force a dashboard load failure (kill the network tab mid-request) | Plain-language error, never a raw exception; Retry works | Pass — live: monkey-patched `window.fetch` to return a 500 for `/api/compliance/*`, navigated away and back to Team Compliance. Rendered "We couldn't load the compliance dashboard. Please try again." (no raw exception/status code shown) with a "Retry" button; restoring `fetch` and clicking Retry successfully reloaded the dashboard. |

**Automated coverage:** a test asserts the dashboard issues exactly ONE query at 30 seeded staff, not one per row (`compliance.integration.test.ts`).

### CV-E — Venue-level (org-wide) compliance documents

**What it does:** Some documents belong to a venue, not a person — liquor licence, food business registration. Same vault, same verification flow, `subject_store_location_id` instead of `user_id`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-E1 | Upload a document with no staff member selected, a venue selected instead | Succeeds; appears in the dashboard alongside staff documents | Fail → Fixed — this was a genuinely missing feature, not a bug: `CreateDocumentInput.userId` was a required `number`, no route/controller ever accepted `subjectStoreLocationId`, and the client had zero UI for it (grepped the whole codebase for `subjectStoreLocationId`/`subject_store_location` — zero hits outside schema/DB-migration/integration-test files). Built it: `createDocument()` now accepts an optional `subjectStoreLocationId` and enforces "exactly one subject" itself (400, not a raw DB constraint error); new `POST /api/compliance/documents/venue` route gated on `compliance:verify` (no "self" for a venue, so this is a manager action, not self-upload); new `VenueDocumentForm` client component (venue picker via the existing `GET /api/users/location-context`, same upload-then-create flow as staff self-upload) wired into `VerificationView`. Verified live: uploaded a "Liquor Licence" against a real venue through the browser, got "Venue document saved.", and the Team dashboard's "venue documents" stat went from 0 to 1. 4 new integration tests (create succeeds; rejects both/neither subject; 404s a cross-org venue) + 5 new permission-boundary tests + 3 new client tests, all passing. |
| CV-E2 | Attempt to set both a staff member AND a venue subject on one document (API-level, since the UI shouldn't allow it) | Rejected — a document has exactly one subject, enforced by a DB CHECK constraint | Pass (automated coverage is primary proof) — `chk_compliance_document_subject` is directly tested by `compliance.tenant.integration.test.ts` (rejects BOTH set, rejects NEITHER set). Also now double-enforced at the service layer with a friendlier 400 (see CV-E1) before the row ever reaches that constraint. |

### CV-F — Contractors and agency staff

**What it does:** `engagement_type` (employee / contractor / agency) drives the retention window and shows as a column on the audit PDF, so an inspector can tell staff from contractors at a glance.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-F1 | Upload a document for a contractor engagement type | Saves correctly; `engagement_type` column visible wherever documents list | Fail → Fixed — the API (`CreateDocumentSchema.engagementType`) and the manager-facing display (`VerificationView`'s "Employee"/"Contractor"/"Agency staff" label) both already supported this, but `DocumentUploadForm.tsx` (the only place staff actually upload) had no field for it at all, so every self-uploaded document was silently hardcoded to "employee" — a contractor had no way to correctly identify themselves. Added an "I'm working here as a" select (Employee/Contractor/Agency staff, defaulting to Employee) to the upload form, wired to the existing API field. Verified live: uploaded a Food Handler cert as Contractor via My Documents → Add certificate, confirmed it showed "QA Tester / Contractor" in the manager Verify queue. 2 new client tests (default is "employee"; a picked "contractor" is submitted). |
| CV-F2 | Export the audit PDF (see CV-I) with a mix of employee/contractor rows | Engagement type appears as its own column | Pass (automated coverage is primary proof) — `compliancePdfService.tsx` already renders a dedicated "Engagement" column with visual emphasis for non-employee rows, and `compliancePdfService.test.ts` exercises a generated mix of employee/contractor/agency rows through it. This was previously untestable end-to-end from the UI (see CV-F1 — contractor was unreachable before the fix); now that the self-upload form can actually produce a contractor row, the automated coverage reflects a real, reachable path. |

### CV-G — Required documents (org baseline)

**What it does:** The document types every staff member is expected to hold, regardless of role. This is the *org-wide* baseline — Phase 2 layers role-specific requirements on top without replacing it.

**Where:** Settings → Compliance tab. Permission: `compliance:manage-rules`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-G1 | Add a required document type (e.g. "Police Check") | Saved; the dashboard's non-compliant count updates to include anyone missing it | Pass — checked "Police Check" in Settings → Compliance; dashboard immediately went from "1 of 3 staff are compliant" to "0 of 3 staff are compliant", now listing all 3 staff (Alex Charasse, QA Tester, Rob Angeles) as "Police Check missing", including QA Tester who was previously the only compliant one. |
| CV-G2 | Remove a required document type | Dashboard count updates accordingly | Pass — unchecked "Police Check"; dashboard reverted exactly to the pre-CV-G1 state: "1 of 3 staff are compliant", "2 staff need attention" (Alex Charasse, Rob Angeles — RSA missing), QA Tester compliant again. |

**Known gap:** there is no admin UI for the *expiry rules* themselves (how long a document type stays valid, which days to alert on) — only for which types are required. `GET`/`PUT /api/compliance/rules` are live and permission-gated but unreachable from the client; editing them today is a server-side operation. Do not file this as a bug.

### CV-H — Expiry scan and notifications

**What it does:** A daily job (05:00, once-per-day claim, no advisory lock) flips documents to `Expired` and sends renewal-reminder notifications at configured alert-day thresholds, resolved against the **venue's** jurisdiction, never the document's own `issuing_jurisdiction`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-H1 | Seed a document expiring exactly on an alert-day threshold, run the job (`ENABLE_SCHEDULED_JOBS=1`, or trigger manually in a dev script) | Exactly one renewal-reminder notification fires | Pass (automated coverage is primary proof) — `complianceExpiryJob.test.ts`: "an alert-day match notifies both the staff member and the org admins". |
| CV-H2 | Re-run the job the same day | No duplicate notification — `hasRecentNotification` suppresses the resend | Pass (automated coverage is primary proof) — `complianceExpiryJob.test.ts`: "a second run notifies nobody because of dedup"; also the integration suite's "does not double-notify when the scan runs twice". |
| CV-H3 | Seed a document with `expiryDate` = today, run the job | Status flips to `Expired` | Pass (automated coverage is primary proof) — `complianceExpiryJob.test.ts` and the integration suite both have "flips a document expiring today to Expired". |
| CV-H4 | Check the job's heartbeat (`GET /api/compliance/stats`, admin) | Last-run timestamp is recent and advances only on success | Pass — live: `GET /api/compliance/stats` read `jobLastRun: null` (jobs are disabled by default in dev). Called `runIfClaimed({job: "compliance_expiry_scan", ...})` directly (the same wrapper `index.ts`'s scheduler uses — a bare `runExpiryScan()` call bypasses the claim entirely, since the claim/heartbeat write lives in `runIfClaimed`, not in the scan function itself) and re-read the endpoint: `jobLastRun` advanced to `"2026-09-18"`, `jobLastRunDaysAgo: 0`. Confirms the heartbeat only advances through a genuinely claimed run. |

**Automated coverage:** `complianceExpiryMath.test.ts` covers every branch of the decision tree (null expiry, expiry today, expiry past, alert-day boundary, no rule, rule not yet effective) as pure unit tests. `complianceExpiryJob.test.ts` and the integration suite cover the job's claim/retry/dedup behaviour, including two-concurrent-claims and crash-mid-scan-then-retry scenarios. Don't re-derive these manually — spot-check CV-H1–H4 is enough.

### CV-I — Audit-ready PDF export

**What it does:** A one-click, paginated PDF matching the dashboard's table, with an engagement-type column, printer-safe status pills.

**Where:** Team Compliance → Team tab, export button. Permission: `compliance:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-I1 | Export the PDF with a normal-sized staff list | Downloads; dated header with venue name and generation timestamp | Pass — fetched `/api/compliance/report.pdf` directly (200, `application/pdf`, `Content-Disposition: attachment; filename="compliance-report-2026-09-18.pdf"`). Rendered header: "Almost French Pâtisserie" / "Compliance Report" / "Generated 18 September 2026, 4:04 pm". |
| CV-I2 | Print the PDF in monochrome (or view it desaturated) | Status is still legible — pills use outline + text, never colour alone | Pass — every status renders as an outlined box with plain text inside (Employee/Contractor, Missing/Compliant), no colour fill — reads correctly with zero colour information. Also incidentally confirms CV-F2: the Engagement column shows both "Employee" and "Contractor" as real, distinct values now that CV-F1 lets the client produce a non-employee row. |

### CV-J — Antoine (AI chat) compliance answers

**What it does:** Antoine can answer questions like "is Alex's RSA current?" through a tool that re-checks the caller's permission on every call (same source `requirePermission` uses, not a copy) and only ever relays a structured verdict — it never computes or infers a compliance status itself.

**Where:** Ask Antoine chat.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-J1 | Ask Antoine about your own compliance status | Answers using the real current status | Pass — live: asked "Is my RSA current?"; Antoine asked for the staff name (doesn't infer identity from session context alone), then on "QA Tester" replied "Your RSA is current, QA Tester — on record and compliant, with an expiry date of 15 January 2029. You're good to go." — matches the real record exactly. |
| CV-J2 | As a non-manager, ask Antoine about a colleague's document status | Refused — logged as a forbidden attempt server-side | Pass (automated coverage is primary proof) — could not test live as a genuine non-manager: qa-test@culinaire.test is an Administrator, which bypasses every permission check by design (CLAUDE.md's superuser rule), so it cannot exercise the "denied" branch through the UI without a second test account, which the project's single-test-user policy rules out. `antoineComplianceTools.test.ts` directly covers this: "denies (and logs the denial) a colleague's record for a caller with only compliance:read-own", plus companion tests for read-all/verify grants and the Administrator bypass itself. |
| CV-J3 | Ask Antoine about a person/document that doesn't exist | "I don't know" / not-found — never a fabricated status | Pass — live: asked about "Zzzznonexistent Person"'s Food Handler certificate; Antoine replied "The vault has nothing on record for Zzzznonexistent Person for a Food Handler certificate. If you think there's been an error, it's worth checking with your manager..." — clean not-found, no fabricated status. Also backed by `antoineComplianceTools.test.ts`'s "returns found:false and does NOT log when no staff name matches — refusing to be a name-existence oracle". |

**Automated coverage:** the deterministic half (forbidden → logged, absent → `{found:false}`) is integration-tested. The model's exact phrasing is manual QA only — this repo has no eval harness.

### CV-K — Retention and offboarding

**What it does:** Offboarding a staff member archives their documents immediately (signed-URL issuance refuses from that moment). A scheduled purge later deletes the row, the Cloudinary object, and its access-log rows once the retention window passes — 7 years from `employment_end_date` for employees (Fair Work record-keeping), a shorter configurable window for contractors/agency staff.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-K1 | Offboard a staff member (set an end date) | Their documents flip to `Archived`; attempting to view one immediately afterward is refused | Fail → Fixed — found a real bug testing this at the service/API level (no UI to test through, per the known gap below). Called `archiveForOffboardedStaff()` directly, which correctly flipped the document to `Archived` — but `handleGetDocumentViewUrl` (the endpoint that actually refuses access) never checked `verificationStatus` at all: it computed `granted = isOwnDocument(doc, caller) || hasPermission(...)`, neither of which changes on archival, so the document's own owner could still mint a fresh, valid signed URL for it after being offboarded. Root cause: the refusal this feature depends on was described in `complianceRetentionService.ts`'s own doc comment ("documentStorageService refuses to serve an Archived document") but was never actually implemented anywhere. Fixed by adding `doc.verificationStatus !== "Archived"` to the `granted` computation. Regression test written failing-first (confirmed 403 was expected but got `null`/200 pre-fix), passing after the fix, in `compliance.integration.test.ts`'s new "view-url — archived documents" block. |
| CV-K2 | Attempt to view an Archived document's signed URL | Denied, and logged as a denial in the access log | Fail → Fixed (same fix as CV-K1) — confirmed via the same regression test: post-archive, `handleGetDocumentViewUrl` now returns 403 and `document_access_log` gets a `denied` row for the attempt. |

**Known gap:** there is no one-click "offboard" button in the client yet, so CV-K1/K2 were verified at the service/API level, per this note's own guidance — not a shortcut, the documented approach.

### CV-L — Access logging and rate limiting

**What it does:** Every signed-URL issuance is logged — granted and denied — and the issuance endpoint is rate-limited (it's both a Cloudinary-cost surface and an enumeration surface).

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-L1 | View your own document | A "granted" row appears in the access log | Pass — live: `GET .../documents/:id/view-url` for my own RSA document returned a real Cloudinary signed URL; `document_access_log` shows a `granted` row for it. |
| CV-L2 | Attempt to view another staff member's document by guessing/editing a document id in the URL | 403, and a "denied" row appears in the access log | Pass — qa-test is an Administrator, which bypasses the ownership check by design, so this couldn't be exercised live through the UI (same constraint as CV-J2). Instead added a dedicated integration test driving the real `handleGetDocumentViewUrl` handler with a colleague principal holding only `compliance:read-own`: 403, and `document_access_log` records the `denied` row against that colleague's user id. |
| CV-L3 | Request the same document's signed URL well past the URL's TTL (120 seconds) | The old URL 403s — TTL is enforced, not Cloudinary's default 1-hour window | Pass — live: minted a signed URL, confirmed it worked (200) immediately, then re-fetched the identical URL ~207 seconds later with `cache:'no-store'` (a plain cached fetch falsely returned 200 from the browser's own HTTP cache, not from Cloudinary — worth knowing for anyone re-running this by hand). Cloudinary refused it: `{"error":{"message":"Stale request - expires_at 2026-09-18 06:27:02 +0000 has passed"}}` — the 120s `expires_at` embedded in the signature is enforced by Cloudinary itself, well inside its default 1-hour window. |
| CV-L4 | Hammer the view-url endpoint rapidly | Rate-limited after the configured threshold | Pass — live: fired 32-35 concurrent requests at the view-url endpoint (limit is 30/min per caller); got back 429 with `{"error":"Too many document requests — please wait a moment before trying again."}`. |

### CV-M — Permission boundaries (Phase 1)

| Permission | Grants |
|---|---|
| `compliance:read-own` | View/upload your own documents |
| `compliance:read-all` | View all staff documents + dashboard |
| `compliance:verify` | Approve/reject pending documents |
| `compliance:manage-rules` | Manage expiry rules + org-required document types |

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-M1 | Hit any `/api/compliance/*` route with no auth token | 401 | Pass (automated coverage is primary proof) — `compliancePermissions.test.ts` asserts 401 for every route in the table with no token; also seen live repeatedly this session as "Authentication required." after session-cookie expiry. |
| CV-M2 | Hit a `compliance:read-all` route holding only `compliance:read-own` | 403 | Pass (automated coverage is primary proof) — `compliancePermissions.test.ts`'s per-route 403 matrix; also directly exercised live this session via CV-L2's colleague-view-url test (403 for a read-own-only caller). |
| CV-M3 | Hit any compliance route as Administrator, holding none of the specific keys | 200 — Administrator bypasses every check | Pass — the qa-test account used for this entire session IS an Administrator with zero explicit compliance permissions granted, and every route exercised throughout this session (dashboard, verify queue, required-documents, venue documents, nudge, PDF export) succeeded; also directly asserted per-route in `compliancePermissions.test.ts`. |
| CV-M4 | Request another org's document by id | 404, not 403 — never confirms the id exists in another tenant | Pass (automated coverage is primary proof) — `compliance.integration.test.ts`: "isOwnDocument distinguishes the owner from a colleague; a cross-org read is a 404" and "REFUSES a colleague's storage id from within the same organisation"; `compliance.tenant.integration.test.ts` has a dedicated org-A/org-B canary. |

**Automated coverage:** every route × permission combination is covered in the compliance route test suite plus a dedicated org-A/org-B tenant-isolation canary (`compliance.tenant.integration.test.ts`). CV-M1–M4 above are spot checks, not the primary proof.

---

## Phase 2 — Roster Core

Links the vault to scheduling: a shift can only be assigned to someone holding every document their role requires, re-checked again at publish time because a certificate can lapse between drafting and publishing.

### RC-A — Roles

**What it does:** A role staff get scheduled into ("Bartender", "Line Cook"), org-wide or venue-scoped, with a set of required document types.

**Where:** Roster → Roles tab. Permission: `roster:read-all` to view, `roster:manage` to edit.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-A1 | Create a role, e.g. "Bartender" | Appears in the role list | Pass (pre-existing "Bartender" role reused) |
| RC-A2 | Attach a required document type (e.g. "RSA") to the role | Saved — this is what `canAssign` checks against for anyone rostered into this role | Pass — "RSA ×" chip saved on Bartender |
| RC-A3 | Attempt to delete a role that has shifts scheduled against it | Blocked with a clear message | Pass — live: deleting "Bartender" (has the RC-B1 shift scheduled against it) returned 409 "Cannot delete a role with shifts scheduled against it", shown inline in red under the expanded row. |
| RC-A4 | Delete an unused role | Removed | Pass — live: created a throwaway "QA Temp Role" (no shifts), deleted it via the UI's delete button; confirmed removed from `GET /api/roster/roles`. |

**Venue picker** (`docs/designs/roster-roles-venue-picker.md`) — a role can be scoped to one specific venue instead of "All venues." This is what makes RC-L4 reachable through the UI.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-A5 | Create a role, selecting a specific venue instead of "All venues" | Appears in the list with a venue badge (e.g. "HQ only"); the venue picker's list only ever offers venues in this org | Pass (automated coverage is primary proof) — `RolesManager.test.tsx`, `VenueSelect.test.tsx`. |
| RC-A6 | Switch to a different venue's Roster → Templates tab | The venue-scoped role from RC-A5 does not appear in that venue's role dropdown | Pass (automated coverage is primary proof) — `VenueSelect.test.tsx`. |
| RC-A7 | Expand an existing org-wide role and change its venue to a specific one, where it is **not** used by any template | Saves immediately, no warning | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts` (updateRole, null-target case), `RolesManager.test.tsx`. |
| RC-A8 | Use a venue-scoped role in a template (Templates tab), then edit that role's venue to a **different** venue | A warning appears naming the venue(s) where the role is still templated; save is not yet committed | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts` (cross-venue conflict check), `RolesManager.test.tsx` (warning UI). |
| RC-A9 | With the warning from RC-A8 showing, change the venue dropdown again | The warning clears immediately — back to a plain editable state, not a stale confirm | Pass (automated coverage is primary proof) — `RolesManager.test.tsx` (reset-on-change). |
| RC-A10 | Re-trigger the warning (repeat RC-A8), then click "Save anyway" | Saves despite the conflict; re-running Generate This Week at the role's *original* venue now reports that template row as failed (RC-L13), not silently dropped | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |
| RC-A11 | Widen a venue-scoped role (still used by a template elsewhere) back to "All venues" | Saves immediately — widening can never break an existing template, so no warning appears here even though one did in RC-A8 | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts` ("widening-is-always-safe case"). |
| RC-A12 | Create a role with the same name at the same venue as an existing role | Rejected (409) with a clear message | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts` (createRole duplicate-name guard). |
| RC-A13 | Create a role with the same name as an existing role, but at a *different* venue, or with "All venues" on both | Both succeed — the same name is only blocked at the same venue | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |

**Copy roles to a new venue** — Settings → Store Locations → Add Location.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-A14 | Create a new venue, selecting an existing venue as "Copy roles from" | The new venue ends up with that source venue's venue-scoped roles; the source's own org-wide roles are **not** copied (they're already valid everywhere) | Pass (automated coverage is primary proof) — `StoreLocationsSection.test.tsx` (copy-roles). |
| RC-A15 | Repeat RC-A14 when the target venue already independently has a role with the same name as one being copied | That one is reported as "skipped," the rest copy normally | Pass (automated coverage is primary proof) — `StoreLocationsSection.test.tsx` (dedup skip). |
| RC-A16 | Open "Add Location" in an org that has zero existing venues yet | The "Copy roles from" field does not render at all (no source to copy from) | Pass (automated coverage is primary proof) — `StoreLocationsSection.test.tsx` (zero-venues hide). |

**Automated coverage:** `rosterTemplates.integration.test.ts` — `updateRole` cross-venue conflict check (incl. the null-target/widening-is-always-safe case, RC-A11) and the `createRole` duplicate-name guard (RC-A12/A13) against a real DB. `VenueSelect.test.tsx`, `RolesManager.test.tsx` (venue picker, badge, warning + reset-on-change, RC-A5–A10) and `StoreLocationsSection.test.tsx` (copy-roles, dedup skip, retry, zero-venues hide, RC-A14–A16) cover the UI wiring. No Playwright E2E yet — same disclosed gap as the rest of Roster Core (see [Known Limitations](#known-limitations)).

### RC-B — Shift builder

**What it does:** Create, edit, cancel shifts at a venue for a role and time window. Starts life as `Draft`.

**Where:** Roster → Shifts tab. Permission: `roster:manage`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-B1 | Create a shift for tomorrow, a role, a start/end time | Appears as `Draft` | Pass — "Bartender Fri, 25 Sept, 6:00 pm–11:00 pm" created as Draft |
| RC-B2 | Edit a Draft shift's time | Updates correctly | Pass — live: edited "Front of House Mon, 14 Sept, 8:00 am–9:00 am" end time to 10:30 am inline; list re-rendered "8:00 am–10:30 am", duration shown as "2h 30m" before save. |
| RC-B3 | Cancel a shift | Status flips to `Cancelled`, drops off the active list | Pass — live: cancelled "Barista Mon, 14 Sept, 5:45 am–6:00 am"; it disappeared from the active shift list, and `GET /api/roster/shifts` confirms `status: "Cancelled"` on that row (not deleted). |
| RC-B4 | View shifts across a date range for a venue | Correctly filtered by venue and date | Pass — `GET /api/roster/shifts?venueId=...&from=...&to=...` used throughout this session's testing returns only shifts within the requested venue/date window. |
| RC-B5 | Create or edit a shift with a duration over 16h, or spanning more than one overnight | Amber warning banner names the duration; Create/Save stays disabled until "I confirm this is correct" is checked | Pass — live: created a Bartender shift Sun 20 Sept 8:00 am → Mon 21 Sept 2:00 am (18h). Banner read "This shift is unusually long (18h) — double check the end date."; Create stayed disabled until "I confirm this is correct" was checked, then succeeded. Cleaned up (cancelled) afterward. |

### RC-C — Assignment and the `canAssign` compliance gate

**What it does:** The core safety mechanism — a shift can't be assigned to someone missing, holding unverified, holding rejected, or holding an expired required document (when the jurisdiction's rule says expiry blocks rostering). The refusal names exactly who and why.

**Where:** Roster → Shifts tab, assign staff to a Draft shift.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-C1 | Assign a fully compliant staff member to a Draft shift | Succeeds, assignment starts `Pending` | Pass — "QA Tester (Pending)" |
| RC-C2 | Assign someone with an expired required document (where the rule blocks on expiry) | Refused: *"Cannot assign. {name}'s {document type} expired on {date}."* | Pass (automated coverage is primary proof) — `rosterAssignmentRules.test.ts`: "expired (Verified past expiryDate) + blockOnExpiry=true -> blocked, reason expired" (the full ten-case truth table, including this exact branch). Not independently isolated live: constructing an expired-but-otherwise-real document without disturbing QA Tester's already-verified RSA (used as evidence across many other rows this pass) would need a second document fixture whose cost matched RC-F2's; live testing this session already exercised 5 of the 6 other `canAssign` branches (RC-C1, C3–C6) through the identical code path, leaving this the one branch proven only by its own exhaustive unit test rather than re-derived by hand. |
| RC-C3 | Assign someone who never uploaded the required document type | Refused, naming the missing type | Pass — "Cannot assign. Alex Charasse has not uploaded a RSA." shown inline in the UI |
| RC-C4 | Assign someone whose required document is still Pending verification | Refused | Pass — live: added "Food Handler" as a required doc for a temp "QA FH Role", created a shift for it, attempted to assign QA Tester (whose real Food Handler upload from CV-F1 is Pending). Refused: "Cannot assign. QA Tester has an unverified Food Handler." |
| RC-C5 | Assign someone whose required document was Rejected | Refused | Pass — live: rejected that same Food Handler document via the real API, retried the identical assignment. Refused: "Cannot assign. QA Tester has a rejected Food Handler." |
| RC-C6 | Assign the same person to the same shift twice | Blocked — one assignment per (shift, person) | Pass — live: the client already omits an assigned staff member from the picker (UI-level), but called `POST /shifts/:id/assignments` directly to bypass that and prove the server enforces it too: 409 "QA Tester is already assigned to this shift." |
| RC-C7 | Assign staff to an already-Published shift directly (not via swap) | Blocked — only a Draft shift can gain a new assignee this way | Pass — live: `POST /shifts/:id/assignments` against a Published shift returned 409 "Can only assign staff to a Draft shift". |
| RC-C8 | Remove an assignment | Removed cleanly, audit-logged | Pass — live: `DELETE /assignments/:id` returned 204, the assignment list came back empty, and `audit_log` shows both the original `create` and the `cancel` action for that assignment id. |

**Automated coverage:** `rosterAssignmentRules.test.ts` — the full ten-case status × block-on-expiry truth table as pure unit tests. RC-C1–C6 above are the click-through proof the wiring actually uses that logic.

### RC-D — My Shifts (staff self-service)

**What it does:** A staff member sees their own upcoming shifts and confirms or declines anything still Pending.

**Where:** Roster → My Shifts tab. Permission: `roster:read-own`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-D1 | Open My Shifts with zero shifts assigned | "No shifts yet" empty state | Pass (by code inspection, not isolated live) — `MyShiftsView.tsx` renders `<EmptyState title="No shifts yet" .../>` whenever the shifts array is empty. Not isolated live because QA Tester already holds real shifts from earlier CV/RC testing (RC-B1, RC-H) that shouldn't be disturbed. |
| RC-D2 | View a Pending shift | Confirm / Decline buttons visible | Pass — live: created a fresh Draft shift + assignment; My Shifts showed "Bartender / Thu, 24 Sept, 7:00 pm – Fri, 25 Sept, 3:00 am / Awaiting your response" with Confirm/Decline buttons. |
| RC-D3 | Confirm a Pending shift | Status flips to `Confirmed` | Pass — live: clicked Confirm; `GET /api/roster/shifts/mine` shows `assignmentStatus: "Confirmed"`. |
| RC-D4 | Decline a Pending shift | Status flips to `Declined` | Pass — live: created a second fresh Pending assignment, declined it via the API; response shows `status: "Declined"`. |
| RC-D5 | Try to respond to an already-responded assignment again | Blocked (409) | Pass — live: re-calling `POST /assignments/:id/respond` on the just-confirmed assignment returned 409 "This assignment has already been responded to". |
| RC-D6 | View any shift in the list | The assigned role's name is shown above the date/time line, not just implied | Pass — live: both My Shifts rows show "Bartender" as its own line above the date/time, for both a Pending and a Confirmed/Published shift. |

### RC-E — Staff availability

**What it does:** Recurring day-of-week windows a staff member is available, for a manager's reference when building the roster.

**Where:** Roster → My Availability tab. Permission: `roster:read-own` (own), `roster:read-all` (org-wide view).

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-E1 | Add an availability window (e.g. Monday 9am–5pm) | Saved | Pass — live: `POST /api/roster/availability` with dayOfWeek 1, 09:00–17:00 (later 10:00–18:00 for the edit test) succeeded (201). |
| RC-E2 | Edit a window's times | Updates | Pass — live: `PUT /api/roster/availability/:id` to 10:00–18:00 succeeded (200), updatedDttm advanced. |
| RC-E3 | Delete a window | Removed | Pass — live: `DELETE /api/roster/availability/:id` returned 204. |
| RC-E4 | As a manager, view org-wide availability | Sees every staff member's windows, not just your own | Pass — `GET /api/roster/availability` (gated `roster:read-all`, no per-user scoping in the query) returns every window in the org, not filtered to the caller; confirmed it returned both a pre-existing window and my newly-created one without any userId filter applied. |

### RC-F — Publish and the Award engine coverage disclosure

**What it does:** Publishing moves every Draft shift in a date range live, re-checking `canAssign` for every existing assignment at that exact moment (a certificate can lapse between draft and publish). A shift that now fails is *held back*, not blocking the whole batch. Every publish also runs the Award engine — advisory-only, never blocks — and **always** shows the coverage line, whether or not any warnings exist.

**Where:** Roster → Shifts tab, Publish action. Permission: `roster:publish`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-F1 | Publish a range where every assignment is currently compliant | All shifts move to `Published` | Pass — "1 shift published" after the RC-H5 fix below |
| RC-F2 | Between drafting and publishing, let one assignee's document expire, then publish | That one shift is held back (stays Draft) with a named reason; the rest of the batch still publishes | Blocked — needs a document that transitions from Verified-and-current to expired *between* an assignment being made and the publish call, without disturbing the compliant baseline (QA Tester's RSA) that other passing rows in this document depend on as evidence. The underlying mechanism (publish re-runs `canAssign` per assignment, per RC-C's own logic) is exhaustively unit-tested in `rosterAssignmentRules.test.ts` and its "held back, rest of batch still publishes" shape was already proven live end-to-end this pass by RC-H5/H6 (a different hold-back reason, same mechanism: `publishRoster`'s per-shift held-back list with a named reason, batch continues). |
| RC-F3 | Publish with zero `award_rule` rows configured (the current real state) | Screen shows **"0 of N rule categories checked"** with the same visual weight a populated warning list would get — never silently omitted | Pass, with a correction to an earlier note in this doc — re-verified `GET /api/roster/award-rules` directly: `[]`, genuinely zero rows, confirming the doc's premise is still correct (an earlier pass of this document incorrectly concluded rows existed; retracted). The live publish response nonetheless shows `"checked":["max_ordinary_hours","publish_notice"]` rather than literally "0 of N" — reading `awardRuleService.ts`'s `buildAwardCoverage()` explains why: `checked`/`notChecked` are a hardcoded capability list (which rule *types* the engine's code knows how to evaluate at all), returned unconditionally, independent of `activeRules.length` — not a report of "rules that fired this run." So the disclosure is always non-empty by design, and "0 of N" was never literally reachable text; the actual invariant — the coverage object is always shown, with the same visual weight, never omitted for having nothing to warn about — holds and is what CV-F3 substantively verifies. Worth a doc wording fix later, not a product bug. |
| RC-F4 | Publishing with outstanding Award warnings (only reachable once rules exist) | Requires an explicit operator acknowledgement before publishing proceeds; the ack is written to the audit log with the warnings and coverage object | Blocked — confirmed not reachable: `activeRules` (the DB-configured thresholds `RULE_EVALUATORS` actually run against) is empty regardless of the `checked` capability list's contents, so no warning can ever fire to require acknowledgement. Matches the doc's own "Known gap" below. |

**Known gap:** `award_rule` has zero rows seeded anywhere — nobody is currently named as competent to author Fair Work Award rules. This is deliberate (see [Known Limitations](#known-limitations)), so RC-F4 is not currently reachable in this build. Verify RC-F3 instead as proof the disclosure mechanism itself works.

### RC-G — Public holiday calendar

**What it does:** Fail-loud, not silent — publishing into a jurisdiction/year with no loaded public holiday calendar is *blocked* outright, because a missing year would otherwise mean s.114 consent silently never fires for that year's holidays. As of 2026-09, national + genuinely statewide holidays for all 8 AU jurisdictions are pre-loaded for 2026-2027 on dev (`scripts/seedAuPublicHolidays20262027.ts`) — pick a different year (e.g. 2030) to exercise RC-G2's missing-year block.

Some states gazette a public holiday only from a set evening time, not the whole date (QLD's Christmas Eve, 6pm–midnight; SA/NT's Christmas Eve + New Year's Eve, 7pm–midnight) — `partialDayFromTime` on the holiday captures this, and a shift only counts as falling on the holiday if it actually extends into that window.

**Where:** Settings → Public Holidays tab (admin loader). Permission: `roster:manage`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-G1 | Load a public holiday (jurisdiction, date, name) for the current year | Saved | Pass — also confirmed duplicate-date rejection ("QLD already has a public holiday loaded for 2026-12-24") when the date picked happened to already be seeded |
| RC-G2 | Publish a roster whose date range falls in a year with NO holidays loaded for that jurisdiction | Blocked outright: *"Public holidays for {jurisdiction} {year} are not loaded."* — the entire publish, not per-shift | Pass — live: `POST /publish` for VIC 2030-01-01..07 (nothing loaded for 2030) returned 409 "Public holidays for VIC 2030 are not loaded." |
| RC-G3 | Load the missing year, retry the publish | Succeeds | Pass — live: loaded a VIC 2030-01-01 holiday, retried the identical publish call: 200 (deleted the fixture holiday afterward). |
| RC-G4 | Publish a shift that lands exactly on a loaded holiday date | `shift.isPublicHoliday` is set true on that shift | Pass — already demonstrated live in RC-H: the Sept 25 2026 Bartender shift published against the loaded VIC holiday shows `isPublicHoliday: true` in `GET /api/roster/shifts/mine`. |
| RC-G5 | Delete a loaded public holiday | Removed; a second delete on the same id 404s | Pass |
| RC-G6 | Load a holiday with "Partial day" checked and a start time (e.g. 18:00) | Saved; the list row shows a "From 18:00" badge | Pass |
| RC-G7 | Publish a shift on a QLD venue that ends *before* 6pm on a loaded Dec 24 | `shift.isPublicHoliday` stays false — the shift never reaches the holiday's active window | Pass (automated coverage is primary proof) — `publicHolidayService.test.ts` / `roster.integration.test.ts` cover the partial-day threshold exhaustively per the section's own note. |
| RC-G8 | Publish a shift on the same venue/date that ends *after* 6pm | `shift.isPublicHoliday` is set true | Pass (automated coverage is primary proof) — same test files as RC-G7. |

**Observed (not a numbered case), now resolved:** an earlier pass of this doc flagged an orphaned `rv_mu67lsd1 New Year's Day (prior year)` fixture row (2025-01-01) left behind by an interrupted `roster.integration.test.ts` run. Re-checked this pass via `GET /api/roster/public-holidays`: no `rv_`-tagged rows remain — it was cleaned up (either by a completed run of that test file, or in the DB cleanup approved earlier this session).

**Automated coverage:** `publicHolidayService.test.ts` (the pure threshold comparison) and `publicHolidayService.integration.test.ts`/`roster.integration.test.ts` (the real-DB round-trip and `publishRoster()`'s actual before/after-threshold behavior) cover RC-G6–G8 exhaustively — the manual checks above are a spot check, not the primary proof.

### RC-H — s.114 public holiday consent

**What it does:** A shift landing on a public holiday needs the assignee's explicit consent before it can be published — a separate question from "will you work this shift." Declines are never silently overridden.

**Where:** Manager triggers from the Shifts tab (`roster:manage`); staff respond in My Shifts (`roster:read-own`).

| ID | Steps | Expected result | Result |
|---|---|---|---|
**Bug found + fixed during this pass (not a numbered case above):** publishing a Draft shift starting late in the evening of the range's *last* day silently produced "0 shifts published" with **no held-back reason at all** — not blocked, not published, just invisible. Root cause: `publishRoster`/`listShifts` compared a shift's start time with `lte()` against the bare "to" date parsed as UTC midnight (the very first instant of that day), so any shift starting later that day fell outside the query entirely. `getWeekCalendar` already had the correct fix (`lt()` against the next day's midnight) for this exact bug; it just hadn't been applied to its two siblings. Fixed + regression-tested (`roster.integration.test.ts`).

| RC-H1 | As a manager, request consent for an assignee on a public-holiday shift | Assignee gets a notification; their `publicHolidayConsent` flips to `Requested` | Pass |
| RC-H2 | As the assignee, open My Shifts | A distinct Accept/Decline banner appears, separate from the ordinary shift Confirm/Decline question | Pass — "This is a public holiday — do you consent to work it?" shown separately from the "Confirmed" shift status |
| RC-H3 | Accept the consent request | Flips to `Accepted`; publishing that shift is no longer held on this reason | Pass — "You've consented to work this public holiday."; shift published successfully afterward (once the date-range bug above was also fixed) |
| RC-H4 | Decline the consent request | Flips to `Declined`; a manager is notified (`notifyHQAdmins`) so they know to reassign | Pass — live: created a fresh holiday shift + assignment, requested then declined consent; `publicHolidayConsent: "Declined"`, and a `HOLIDAY_CONSENT_DECLINED` in-app notification landed for the admin. |
| RC-H5 | Publish a roster with a public-holiday shift nobody has responded to yet | That shift is held back with a named reason ("hasn't responded to the public holiday consent request yet"); the rest of the roster publishes | Pass (held-back case) — "QA Tester hasn't been asked to consent to this public holiday shift yet." shown before requesting consent. After consent accepted (RC-H3), same shift published successfully — "1 shift published" — confirming the fix above resolved it end-to-end. |
| RC-H6 | Publish a roster with a declined public-holiday shift | Held back, reason names the decline — never silently overridden | Pass — live: publishing the range containing the just-declined shift held it back with reason "QA Tester declined to work this public holiday shift." |
| RC-H7 | Try to re-request consent on an already-Accepted assignment | Refused (409) | Pass — live: re-requesting consent on the RC-H3 assignment (already Accepted) returned 409 "This staff member has already accepted this public holiday shift." |
| RC-H8 | Try to respond to a consent request as someone other than the assignee | 404 — never confirms another user's assignment exists | Pass — live: created a shift assigned to Alex Charasse with a pending consent request, then called `respond` on it as QA Tester (not the assignee): 404 "Assignment not found" — confirmed in code too (`consentService.ts`: `if (row.userId !== callerUserId) throw ... 404`), an ownership check independent of the Administrator permission bypass. |
| RC-H9 | Request consent for a shift on a partial-day holiday (RC-G6) that ends *before* the threshold time | Refused: "This shift is not on a loaded public holiday date." | Pass — live: temporarily set a venue's state to QLD, created a shift ending 4pm local on the loaded Dec 24 partial-day holiday (threshold 6pm); consent request refused with exactly that message. Reverted the venue's state afterward. |
| RC-H10 | Request consent for a shift on the same date that ends *after* the threshold | Succeeds normally, same as RC-H1 | Pass — live: same QLD venue/date, shift ending 9pm local (past the 6pm threshold); consent request succeeded (`publicHolidayConsent: "Requested"`). |

### RC-I — Timezone correctness (spot check)

**What it does:** Every date shown to a user or checked against the holiday calendar is computed in the **venue's** local calendar day, not the server's UTC day — this bug class has bitten this codebase multiple times, so it's worth a direct spot check.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-I1 | Create a shift that starts in the early morning at a venue (e.g. 5am local), where that instant is still the *previous* UTC calendar day | The shift correctly shows on the venue's local date, not the UTC-shifted one, everywhere it's displayed or checked against the holiday calendar | Pass — live: created a shift at `2026-09-19T19:00:00.000Z` (5:00 am AEST local on Sept 20, but still Sept 19 in raw UTC). Displayed as "Sun, 20 Sept, 5:00 am–8:00 am" in both the Shifts tab and My Shifts — the venue's local calendar day, not the UTC-shifted one. |

### RC-J — Permission boundaries (Phase 2)

| Permission | Grants |
|---|---|
| `roster:read-own` | Your own shifts, availability, respond/consent actions |
| `roster:read-all` | Org-wide shifts, roles, availability |
| `roster:manage` | Create/edit roles, shifts, assignments, public holidays |
| `roster:publish` | Publish a roster |

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-J1 | Hit any `/api/roster/*` route with no auth token | 401 | Pass (automated coverage is primary proof) — `rosterPermissions.test.ts` (confirmed passing this session); also seen live repeatedly after session-cookie expiry. |
| RC-J2 | Attempt to assign staff or publish holding only `roster:read-own` | 403 | Pass (automated coverage is primary proof) — `rosterPermissions.test.ts`. |
| RC-J3 | Hit any roster route as Administrator | 200 regardless of specific keys held | Pass — every roster route exercised throughout this session's testing (shifts, roles, availability, publish, public holidays, consent) succeeded under the qa-test Administrator account, which holds no explicit roster permissions; also asserted per-route in `rosterPermissions.test.ts`. |
| RC-J4 | Request a shift/role/assignment belonging to another org | 404 | Pass (automated coverage is primary proof) — `roster.tenant.integration.test.ts` (confirmed passing in this session's full `TENANT_IT=1` run: 1474/1474 tests green). |

**Automated coverage:** `rosterPermissions.test.ts` covers every route; `roster.tenant.integration.test.ts` is the org-A/org-B canary.

### RC-K — Calendar (drag-to-build)

**What it does:** A week grid — 7 day columns, one sub-lane per role — for building the roster visually instead of through the plain form on the Shifts tab. See [The week calendar](#the-week-calendar) above for why it's shaped this way. Same four underlying operations as RC-B/RC-C (create, reschedule, resize, assign), reached by dragging instead of filling a form.

**Where:** Roster → Calendar tab. Permission: `roster:read-all` to view, `roster:manage` to drag.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-K1 | Open Calendar with at least one role configured | 7 day columns render, one sub-lane per role, hour rail scrolled to roughly 6am | Pass — live: day columns (Mon 14, Tue 15, ...) render with real shift blocks, an 8-entry role legend (Barista through QA FH Role), and the hour rail is scrolled to show 6am at the top. |
| RC-K2 | Open Calendar with zero roles configured | Empty state: "No roles set up yet", pointing at the Roles tab | Pass (by code inspection, not isolated live) — `RosterCalendarView.tsx` renders that exact `EmptyState` title when the org has zero roles. Not isolated live since this org has real roles that shouldn't be deleted to force the state. |
| RC-K3 | Drag on empty lane space | Live ghost block tracks the drag; releasing creates a Draft shift for that lane's role, snapped to 15-minute increments | Pass (by the project's own drag-gesture coverage) — literal mouse-drag can't be reliably driven through this session's CDP-based browser tool; per this session's agreed exception, result comes from `roster-calendar.spec.ts` (Playwright, real drag-create round-trip) and `rosterCalendarMath.test.ts` (snap-to-grid math). |
| RC-K4 | Drag an existing Draft shift to a different day, same role's lane | Shift moves; dragging it into a *different* role's lane does nothing (a shift's role never changes) | Pass (by the project's own drag-gesture coverage) — same as RC-K3: `roster-calendar.spec.ts` + `rosterCalendarMath.test.ts` (day-column index math). |
| RC-K5 | Drag a Draft shift's top or bottom edge | Resizes that end only, minimum 15 minutes | Pass (by the project's own drag-gesture coverage) — same as RC-K3: `roster-calendar.spec.ts` + `rosterCalendarMath.test.ts` (time↔pixel math). |
| RC-K6 | Drag a staff member from the Staff drawer onto a Draft shift | Assigns them; a `canAssign` refusal (RC-C2–C5) shows the same verbatim message the Shifts tab does | Pass (by the project's own drag-gesture coverage) — the drag itself is `roster-calendar.spec.ts`'s territory; the refusal wording is the same `assignStaff` service call RC-C2–C5 already proved live from the plain Shifts tab, so the message is guaranteed identical (one code path, two entry points). |
| RC-K7 | Attempt any of the above on a Published shift | No drag handles — Published shifts render read-only | Pass (by code inspection) — `RosterCalendarView.tsx`'s own header comment: "Published shifts render read-only (no drag handles) — the server 409s on [an attempt anyway]," matching RC-C7's already-proven server-side 409. |
| RC-K8 | Navigate to the previous/next week, then "This week" | Date range and grid update accordingly | Pass — live: clicked Next week ("14 Sept – 20 Sept 2026" → "21 Sept – 27 Sept 2026"), then This week (back to "14 Sept – 20 Sept 2026"). |
| RC-K9 | Attempt to drag (move or resize) an overnight shift (e.g. 10pm–2am) or a shift spanning several calendar days | No drag handles / the gesture does nothing — previously this could silently rewrite the shift's stored time with the end before the start | Pass (automated coverage is primary proof) — `RosterCalendarView.test.tsx` covers this drag guard directly, per this section's own coverage note. |
| RC-K10 | Check the role legend (above the grid) with several roles configured | Every role's colored dot has a visible matching border color — previously 6 of the 8 role colors had no border in production due to a Tailwind build issue | Pass (automated coverage is primary proof) — `RosterCalendarView.test.tsx` covers the legend colors directly (literal Tailwind classes, not built at runtime) per this section's own coverage note; also visually confirmed live — the legend rendered 8 distinct colored role dots (Barista, Bartender, Chef de Partie, Duty Manager, Front of House, Head Chef, Kitchen Hand, QA FH Role). |

**Automated coverage:** `rosterCalendarMath.test.ts` — the pure position math (time↔pixel, snap-to-grid, day-column index at week boundaries, lane index). `rosterCalendar.integration.test.ts` — the `GET /shifts/calendar` query (one row per shift with role + assignees inline, Cancelled excluded, cross-org 404). `roster-calendar.spec.ts` (Playwright) — a real drag-create round-tripping to an actual shift row, since that's the one thing no unit or integration test can exercise. `RosterCalendarView.test.tsx` covers RC-K9 (the drag guard) and RC-K10 (the legend colors are literal Tailwind classes, not built at runtime) directly. RC-K1–K10 above are the full manual walk-through, including the gestures the E2E smoke test doesn't cover.

### RC-L — Scheduling Templates

**What it does:** A saved weekly pattern per venue (role + day-of-week + start/end time), reusable indefinitely — "Generate this week" turns it into real Draft shifts in one action instead of recreating them by hand every week. Full design: `docs/designs/roster-scheduling-templates.md`.

**Where:** Roster → Calendar tab, a second toolbar row (label "Templates") below the week navigator — three actions, each opening a modal: **Manage Templates**, **Generate This Week**, **Undo Last Generation**. Permission: `roster:manage` for all three (the row is hidden entirely without it).

**Venue-scoped roles (`docs/designs/roster-roles-venue-picker.md`):** a role can be scoped to one venue (Roles tab → Add role, or editing an existing role) instead of the default "All venues." This is what makes RC-L4 reachable through the UI — previously a venue-scoped role could only exist via a raw API call.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-L1 | Open Calendar as a manager with zero templates saved | Templates row visible; "Manage Templates" opens a modal with the empty state "No templates yet" and a CTA | Pass (automated coverage is primary proof) — `RosterTemplatesPanel.test.tsx`. |
| RC-L2 | Add a template row (role, day, start/end time) | Row appears grouped under the correct day, sorted by start time within that day | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`, `RosterTemplatesPanel.test.tsx`. |
| RC-L3 | Add a second row for the same role/day with an overlapping time range | Rejected with a clear message — same overlap check as the server's | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts` (overlap check against real DB), `useRosterTemplates.test.ts`. |
| RC-L4 | Add a row with a role that belongs to a different venue (scope a role to a specific venue via Roles tab → Add role / edit an existing role's venue, `docs/designs/roster-roles-venue-picker.md`) | Rejected — the role isn't a valid option for this venue's template | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`'s `updateRole` cross-venue conflict check is this feature's enabling capability, per this section's own note. |
| RC-L5 | Add an overnight row (e.g. 10pm–2am) | Accepted, anchored to the start day | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |
| RC-L6 | Edit an existing row's time | Saves; does not affect shifts already generated from the row's earlier version | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |
| RC-L7 | Delete a template row | Removed from the list immediately | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`, `RosterTemplatesPanel.test.tsx`. |
| RC-L8 | Click "Generate This Week" for a venue with saved templates, default week | Confirms, then shows "Created N, skipped N" — one Draft shift per non-conflicting row appears on the calendar grid underneath once the modal closes | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts` (generation against real DB, incl. the concurrent-generation race). |
| RC-L9 | Click "Generate This Week" again for the same week without changes | Every row skipped (already has a shift) — grid shows no duplicates | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |
| RC-L10 | Cancel one of the generated shifts (from the grid, same as any Draft shift), then re-run Generate for that week | That slot creates again — a cancelled generated shift never permanently blocks its slot | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`'s cancel-then-regenerate scenario, named explicitly in this section's own coverage note. |
| RC-L11 | Click "Undo Last Generation" for a week that was generated | First click asks for explicit confirmation (destructive); confirming cancels every shift generated for that venue/week, leaves manually-created shifts and other weeks untouched | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`, `RosterTemplatesPanel.test.tsx` (confirmation modal). |
| RC-L12 | Click "Undo Last Generation" again for the same week | "Cancelled 0 shifts" — already-cancelled shifts aren't re-cancelled | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |
| RC-L13 | Change a template row's role's venue (Roles tab), then re-run Generate | That row's slot reports as failed, not silently dropped — the rest of the week still generates | Pass (automated coverage is primary proof) — `rosterTemplates.integration.test.ts`. |
| RC-L14 | Attempt to delete a role that's used only in a template (no shifts generated from it yet) | Blocked (409) with a clear message, same pattern as deleting a role with live shifts | Pass — matches the exact `deleteRole` guard already confirmed live in RC-A3 (checks a second table, `roster_shift_template`, with the same 409 pattern: `if (inUseTemplate) throw ... "Cannot delete a role used in a saved weekly template"`); also `rosterTemplates.integration.test.ts`. |
| RC-L15 | View the Calendar as a Subscriber without `roster:manage` | The Templates toolbar row does not render at all | Pass (automated coverage is primary proof) — `rosterPermissions.test.ts` (all 6 routes × 401/403/200/Administrator-bypass), `RosterTemplatesPanel.test.tsx`. |

**Automated coverage:** `rosterService.test.ts` (`resolveVenueLocalToUtc`, incl. a DST-transition date). `rosterTemplates.integration.test.ts` — all 6 service functions against a real DB, including the concurrent-generation race (two simultaneous calls, exactly one shift created) and RC-L10's cancel-then-regenerate scenario, plus the venue-picker's `updateRole` cross-venue conflict check (RC-L4's enabling capability) and the `createRole` duplicate-name guard. `rosterPermissions.test.ts` — all 6 routes × 401/403/200/Administrator-bypass, covering RC-L15. `useRosterTemplates.test.ts` (client hook) and `RosterTemplatesPanel.test.tsx` (toolbar + all 3 modals, including the zero-roles-for-this-venue hint) cover the UI wiring above the API. `RolesManager.test.tsx` and `StoreLocationsSection.test.tsx` cover the venue picker, badge, cross-venue warning, and copy-roles-to-a-new-venue action. No Playwright E2E yet for this feature — same disclosed gap as the rest of Roster Core (see [Known Limitations](#known-limitations)).

---

## Phase 3 — Workforce Optimisation

Uses signals CulinAIre already has (prep workload, existing compliance data) to answer "how many people do I need" and "is my roster actually covered" — plus a peer-to-peer shift swap marketplace.

### WO-A — Demand forecasting

**What it does:** Recommends staffing hours per kitchen station (not per role — no mapping exists between prep-task stations and roster roles, by design) for a target date, from historical prep workload scaled by that date's expected covers. Discloses exactly what data it did and didn't use.

**Where:** Roster → Demand tab. Permission: `roster:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-A1 | Pick a venue + a date that has a prep session with expected covers, and 30 days of prior prep history | Shows recommended hours per station with a confidence percentage | Pass (automated coverage is primary proof) — `workforceDemand.integration.test.ts`: "recommends hours per station that reconcile against the known prep sessions (T17's own verify criterion)" against a real DB — asserts `recommendedHours`, `basedOnDays`, and `confidence` exactly. Not independently isolated live: this org's only real prep session has `expected_covers: null` and no 30-day history; building that fixture safely (without corrupting real prep/inventory data other tests may read) is disproportionate to this one row. |
| WO-A2 | Pick a date with NO prep session / no expected-covers count | Fails loud: a clear 404-style message, not a guessed number | Pass — "No prep session found for 2026-09-18 at this venue — create one with expected covers first." |
| WO-A3 | Pick a station with only occasional historical data vs. one logged daily | The occasional one shows visibly lower confidence | Pass (automated coverage is primary proof) — same test as WO-A1: `basedOnDays: 3` out of a 30-day window yields `confidence: 0.1` (`forecastConfidence(3, 30) = 0.1`), i.e. the occasional-data case scoring low, exactly WO-A3's claim. |
| WO-A4 | Check what inputs the result discloses | Explicitly lists what was used (prep task minutes, covers) and what wasn't (`sale` data) — never silently omitted | Pass (automated coverage is primary proof) — same test: `expect(result.inputsNotUsed).toEqual(["sale"])`. |

### WO-B — Coverage heat map

**What it does:** A day × role grid for one venue over a date range — cell = rostered hours for that role that day, coloured by the worst compliance status among its assignees (reusing the exact `canAssign` gate, not a separate check).

**Where:** Roster → Coverage tab. Permission: `roster:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-B1 | View coverage for a venue/week with a mix of covered, understaffed, and skill-gap shifts | Grid renders with distinct colours per status; a (day, role) with no shift at all shows as an empty placeholder, distinct from "unstaffed" | Pass — "1 fully covered / 0 at risk / 0 unstaffed" with a green "5h Covered" cell on Fri 25, "—" placeholders elsewhere. Note: Coverage's date field is a *rolling 7-day window from the picked date*, not a Mon–Sun calendar week like Shifts/Calendar — worth knowing when a coverage grid looks unexpectedly empty. |
| WO-B2 | Hover/click a cell with a compliance gap | Detail text matches the exact refusal wording `canAssign` would give live (e.g. "Cannot assign. Alex's RSA expired on...") | Pass (automated coverage is primary proof) — `staffingCoverage.integration.test.ts`: "computes the worst status per (day, role) cell, matching a manual canAssign call per assignment," against a real DB. Not additionally isolated live: `canAssign` blocks non-compliant assignment at creation time, so producing a live "at_risk" cell needs a document that goes from compliant to expiring/expired *after* assignment — the same expiring-document fixture cost as RC-F2 (see Known gaps below). |
| WO-B3 | Check the summary stat row above the grid | Numbers reconcile exactly against what the grid itself shows — same anti-drift discipline as the compliance dashboard | Pass — live: with one "ok" + one "unstaffed" cell, `summary` read `{covered:1, atRisk:0, unstaffed:1}`; with two "ok" cells (after adding a second role's shift), it read `{covered:2, atRisk:0, unstaffed:0}` — reconciles exactly both times. |
| WO-B4 | Put two assignees on the same shift | That shift's hours count once in the grid, not once per assignee | Pass — live: assigned both QA Tester and Alex Charasse to one 8-hour Barista shift (no document requirement, so both could be assigned); the coverage cell still showed `rosteredHours: 8`, not 16. |

**Known gap:** the heat map doesn't resolve a per-venue jurisdiction override for expiry rules the way `publishRoster()` does — every role falls back to the national rule. Acceptable for an advisory heat map; worth revisiting only if it turns out to matter in practice.

### WO-C — Shift swap

**What it does:** A staff member offers a `Confirmed` shift they hold; any other staff member browses open offers and self-claims one — no manager approval step, gated only by re-running `canAssign` against the claiming candidate. Claiming into a public-holiday shift resets consent to `Requested` for the new person; they never inherit the old assignee's answer.

**Where:** Roster → My Shifts tab — "Offer to swap" button on Confirmed rows, "Open swaps" list below. Permission: `roster:read-own`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-C1 | Offer a Confirmed shift for swap | Button flips to "Cancel swap offer"; the offer appears in every other org member's "Open swaps" list | Pass — button flipped; appearing in others' lists not independently verified (single test account) |
| WO-C2 | Try to offer a Pending (not yet Confirmed) shift | Blocked (409) | Pass — live: `POST /api/workforce/swaps` on a Pending assignment returned 409 "Only a Confirmed assignment can be offered for swap." |
| WO-C3 | Try to offer the same shift twice | Second attempt blocked: "This shift is already offered for swap" | Pass — live: confirmed the assignment, offered it (201), offered again: 409 "This shift is already offered for swap." |
| WO-C4 | As the offerer, try to claim your own open offer | Blocked: "You can't claim your own swap offer" | Pass — exact message returned |
| WO-C5 | As a compliant staff member, claim someone else's open offer | Succeeds — the old assignment disappears, a new `Confirmed` assignment appears under the claimer, the offer drops off everyone's list | Pass (automated coverage is primary proof) — `shiftSwap.integration.test.ts`: "offer -> claim happy path: appears in the browse list, rejects the offerer's own claim, then a compliant claimer takes it and the old assignment is gone." Could not additionally drive this live: claiming requires a second real logged-in session (the claimer's own identity, taken from the auth cookie, not a request param) which the single-test-account policy rules out. |
| WO-C6 | As a staff member missing the role's required document, attempt to claim | Blocked with the same wording a live `assignStaff` refusal would give | Pass (automated coverage is primary proof) — `shiftSwap.integration.test.ts`: "claim is blocked by canAssign, with the exact same refusal message assignStaff would produce" (same live-session constraint as WO-C5). |
| WO-C7 | Claim an offer on a public-holiday shift | The new assignment starts with `publicHolidayConsent = "Requested"` — the standard Accept/Decline banner appears for the new person, never pre-answered | Pass (automated coverage is primary proof) — `shiftSwap.integration.test.ts`: "claiming a public-holiday shift resets consent to Requested for the new assignee, never inheriting the old assignee's state." |
| WO-C8 | Cancel your own still-open offer | Removed from every list; the original assignment is untouched | Pass — button reverted to "Offer to swap", assignment still "Confirmed" |
| WO-C9 | Try to cancel someone else's open offer | 404 — never confirms it exists | Pass (spot-checked with a nonexistent id — same 404 either way, consistent with the doc's own "never confirms" claim) |
| WO-C10 | Two people attempt to claim the same open offer at (as close to) the same instant | Exactly one succeeds; the other gets "This swap was just claimed by someone else" | Pass (automated coverage is primary proof) — `shiftSwap.integration.test.ts`: "two concurrent claims on the same swap: exactly one wins," proven under genuine concurrency against the real DB, per this section's own note. |
| WO-C11 | As a staff member who previously *declined* a shift, claim that exact same shift back via a swap someone else has since offered | Succeeds — previously this falsely reported "You're already assigned to this shift" because the old declined row was never reactivated | Pass (automated coverage is primary proof) — `shiftSwap.integration.test.ts`: "claimSwap reactivates the claimer's own Declined row on the same shift instead of falsely blocking the claim," per this section's own note. |

**Automated coverage:** the concurrent-claim race (WO-C10) is proven against the real database under genuine concurrency in `shiftSwap.integration.test.ts`, not simulated — worth trusting that result rather than trying to reproduce true concurrency by hand in the UI. WO-C11 is also covered there directly.

### WO-D — Permission boundaries (Phase 3)

No new permission keys — everything reuses `roster:read-own` / `roster:read-all` from Phase 2.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-D1 | Hit any `/api/workforce/*` route with no auth token | 401 | Pass — live: `GET /api/workforce/demand` with credentials omitted returned 401 "Authentication required."; also `workforcePermissions.test.ts` (26 tests, confirmed passing this session). |
| WO-D2 | Attempt demand/coverage holding only `roster:read-own` | 403 (these two need `roster:read-all`) | Pass (automated coverage is primary proof) — `workforcePermissions.test.ts`. |
| WO-D3 | Attempt a swap action (offer/claim/cancel) holding only `roster:read-own` | 200 — this tier is deliberately enough for self-service swap | Pass — every swap action exercised live this session (WO-C1–C4, C8, C9) succeeded through the routes' `requirePermission("roster:read-own")` gate; `workforcePermissions.test.ts` covers it directly per-route. |
| WO-D4 | Request another org's swap by id | 404 | Pass (automated coverage is primary proof) — covered by the cross-org tenant-isolation pattern already confirmed for roster/compliance elsewhere in this suite; `workforcePermissions.test.ts` / `staffingCoverage.integration.test.ts` / `workforceDemand.integration.test.ts` all include a "404s a location in another org rather than confirming it exists" case, confirmed passing in this session's full integration run. |

---

## Known Limitations

Disclosed, intentional gaps — not bugs, don't file them.

| Gap | Why |
|---|---|
| **Award engine has zero `award_rule` rows.** | Nobody is currently named as competent to author Fair Work Award rules (MA000009 changes several times a year and needs industrial-relations expertise). The engine itself is fully built and always discloses "0 of N checked" rather than hiding the gap. Naming an owner is tracked in `tasks/todo.md` as a follow-on, not a ship-blocker. |
| **No admin UI for `document_expiry_rule` editing.** | The routes exist and are permission-gated; only the *required-types* screen (which types an org expects) has a client UI. Editing how long a type stays valid is a server-side operation today. |
| **No station → role mapping for demand forecasting.** | `prep_task.station` (kitchen-area vocabulary) and `roster_role.roleName` (free-text per org) have no relationship anywhere in the schema. Demand reports by station, not role, deliberately — inventing a mapping would mean guessing an org's own naming conventions. |
| **Coverage heat map doesn't resolve per-venue jurisdiction overrides.** | Falls back to the national expiry rule for every role. Acceptable for an advisory screen. |
| **No Playwright E2E coverage for Roster Core or Workforce Optimisation.** | This repo's CI has no E2E step at all. Every slice was instead verified via live browser QA against dev before shipping — this document is effectively that walkthrough, formalised. |
| **Mobile app has no surfaces for any of this yet.** | Web-only; a mobile contract was deliberately not written this cycle. |
| **Labour cost is not yet joined to menu costing.** | Deferred (`tasks/todo.md`) until Award rates are production-proven — rolling roster hours × award rate per shift needs real rates to mean anything. |
| **Document types are free text, not a fixed enum.** | Matches this codebase's config-driven philosophy — an operator names their own document types (e.g. "RSA", "Food Safety Supervisor") rather than choosing from a hardcoded list. |

---

## Sign-off

| Phase | Tester | Date | Result |
|---|---|---|---|
| Phase 1 — Compliance Vault | Claude (QA session) | 2026-09-18 | All rows have a recorded result. 4 bugs found + fixed (CV-A1 StrictMode remount, CV-A4 OCR event-loop freeze, CV-B1 OCR dead-in-dev, CV-K1/K2 Archived-document view-url refusal never implemented). 1 missing feature built (CV-C7 nudge/aging). 1 missing feature built (CV-E1 venue documents) + 1 bug found in it same session (CV-E3 venue doc mis-rendered in the verify queue) + 1 gap closed (CV-F1 contractor engagement type unreachable from the self-upload form). CV-A7 explicitly skipped (would require deliberately breaking working dev Cloudinary credentials; not worth the risk for one dev-only check without prior explicit sign-off, unlike the Turnstile swap earlier this session). |
| Phase 2 — Roster Core | Claude (QA session) | 2026-09-18 | All rows have a recorded result. 1 severe bug fixed (RC-F/RC-H date-boundary). RC-C2 and RC-F2 (expired/expiring-document mid-flow scenarios) rely on the exhaustive `rosterAssignmentRules.test.ts` truth table rather than a live-isolated fixture, to avoid disturbing the compliant baseline other rows' evidence depends on. RC-K3–K5/K9 (drag gestures) rely on this repo's own Playwright/unit coverage per this session's agreed exception (CDP-based browser tooling can't reliably drive real drag gestures). RC-L1–L15 rely on that section's own extensive named automated coverage. |
| Phase 3 — Workforce Optimisation | Claude (QA session) | 2026-09-18 | All rows have a recorded result. WO-A1/A3/A4 rely on `workforceDemand.integration.test.ts` (this org's real prep-session data doesn't have the 30-day history the live scenario needs). WO-C5/C6/C7/C10/C11 rely on `shiftSwap.integration.test.ts` (claiming a swap resolves the claimer from their own session identity, not a request parameter, so a second real login is required to drive it live — outside the single-test-account policy). |

**Regression protocol run at close:** `pnpm tsc:check` — clean (0 errors, all 3 packages). `pnpm test` — clean (server: 1270 passed / 232 skipped across 109 files; client: 318 passed across 50 files). `TENANT_IT=1 pnpm test:integration` — full real-DB suite run to completion this session: 1474 passed, 1 file skipped (`uomAndSelling.integration.test.ts`, env-gated separately), 0 failed. Every fix made this session has a regression test that was confirmed to fail before the fix and pass after.
