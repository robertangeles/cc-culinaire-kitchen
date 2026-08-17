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

## Phase 1 — Staff Compliance Vault

A private vault for staff and venue compliance documents (RSA, Food Safety Supervisor certificate, police check, Medicare card, liquor licence — document types are free text, not a fixed list), a manager verification queue, and an org-wide dashboard. Answers "is everyone current?" — deciding who can be *rostered* is Phase 2.

### CV-A — Staff document upload

**What it does:** A staff member uploads their own certificate. The file goes to Cloudinary as a *private* asset (never a public URL, never local disk) with magic-byte validation, and the resulting document starts `Pending` until a manager verifies it.

**Where:** Profile → My Documents tab. Permission: `compliance:read-own`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-A1 | Open Profile → My Documents with zero documents uploaded | Empty state: "Add your first certificate", camera icon, "Takes about a minute" copy | |
| CV-A2 | Upload a real photo/PDF of a certificate, fill in document type, issue date, expiry date | Document appears in the list with status **Pending** | |
| CV-A3 | Upload a `.svg` file | Rejected — SVGs are explicitly excluded from the allowed upload types for this path | |
| CV-A4 | Rename a `.pdf` to `.jpg` and upload it | Rejected on magic-byte sniffing (extension is ignored; the actual file signature is checked) | |
| CV-A5 | Upload a zero-byte file | Rejected | |
| CV-A6 | Upload a document with the same type + document number as one already on file | Rejected: "You've already uploaded a `{type}` with this document number" | |
| CV-A7 | Upload while Cloudinary credentials are misconfigured (dev-only check, don't try in prod) | 503 "Can't accept uploads right now" — nothing written anywhere, no local-disk fallback | |

### CV-B — OCR pre-fill

**What it does:** On upload, the client downscales the photo (~1600px) and the server runs OCR (tesseract, one warm worker, serialised) inside a 5-second budget. Recognised fields pre-fill the form with a visible marker; anything OCR can't read falls back to manual entry with no error shown to the user.

**Where:** Same upload flow as CV-A.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-B1 | Upload a clear, well-lit certificate photo | Some fields pre-fill automatically, visibly marked as OCR-read (not indistinguishable from manually typed) | |
| CV-B2 | Upload a blurry or upside-down photo | Falls through to a normal empty form — no error toast, no stall past ~5s | |
| CV-B3 | Upload two documents back-to-back quickly | Second OCR call queues behind the first rather than erroring (one worker, serialised) | |

### CV-C — Manager verification queue

**What it does:** A manager reviews each Pending document side-by-side with the original photo and approves or rejects it.

**Where:** Team Compliance → Verify tab. Permission: `compliance:verify`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-C1 | Open Verify with zero pending documents | "Nothing waiting on you" — calm, not an error state | |
| CV-C2 | Open a pending document | Split view: certificate photo on one side, typed fields on the other, OCR-filled fields visibly marked | |
| CV-C3 | Approve a document | Status flips to **Verified**; the uploader gets a push/in-app notification | |
| CV-C4 | Try to reject without entering a reason | Blocked — reject requires a reason | |
| CV-C5 | Reject with a reason | Status flips to **Rejected**; uploader is notified with the reason and what to fix | |
| CV-C6 | As the uploader, check the Pending state before it's actioned | Shows who it's with and since when | |
| CV-C7 | Leave a document pending 48+ hours (or fake the clock in a lower environment) | Staff member gets a "nudge" affordance; the item visibly ages for the manager | |

### CV-D — Compliance dashboard

**What it does:** One screen answering "who is non-compliant right now," reconciled so the headline number and the detail table can never disagree (both resolve the *best* document per staff × required-type pair, in SQL, against `CURRENT_DATE`).

**Where:** Team Compliance → Team tab. Permission: `compliance:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-D1 | Open with zero non-compliant staff | All-clear state — calm gold check, no red, next expiry noted | |
| CV-D2 | Make exactly one staff member non-compliant (expire or reject their document) | Named person, one Review button, red left edge | |
| CV-D3 | Make three or more staff non-compliant | "N staff need attention" — stacked rows in one card, expired sorted before expiring, each with its own Review link | |
| CV-D4 | Compare the headline count against the detail table below it | They always agree — this was a real bug class before shipping (see the compliance-expiry-engine wiki page), now structurally prevented | |
| CV-D5 | Open with zero staff in the org at all | "No one on the team yet" — distinct from CV-D1 (zero staff vs. zero non-compliant staff are different states) | |
| CV-D6 | Filter the staff table to something matching nobody | "No staff match that filter" — distinct from CV-D5 | |
| CV-D7 | Force a dashboard load failure (kill the network tab mid-request) | Plain-language error, never a raw exception; Retry works | |

**Automated coverage:** a test asserts the dashboard issues exactly ONE query at 30 seeded staff, not one per row (`compliance.integration.test.ts`).

### CV-E — Venue-level (org-wide) compliance documents

**What it does:** Some documents belong to a venue, not a person — liquor licence, food business registration. Same vault, same verification flow, `subject_store_location_id` instead of `user_id`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-E1 | Upload a document with no staff member selected, a venue selected instead | Succeeds; appears in the dashboard alongside staff documents | |
| CV-E2 | Attempt to set both a staff member AND a venue subject on one document (API-level, since the UI shouldn't allow it) | Rejected — a document has exactly one subject, enforced by a DB CHECK constraint | |

### CV-F — Contractors and agency staff

**What it does:** `engagement_type` (employee / contractor / agency) drives the retention window and shows as a column on the audit PDF, so an inspector can tell staff from contractors at a glance.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-F1 | Upload a document for a contractor engagement type | Saves correctly; `engagement_type` column visible wherever documents list | |
| CV-F2 | Export the audit PDF (see CV-I) with a mix of employee/contractor rows | Engagement type appears as its own column | |

### CV-G — Required documents (org baseline)

**What it does:** The document types every staff member is expected to hold, regardless of role. This is the *org-wide* baseline — Phase 2 layers role-specific requirements on top without replacing it.

**Where:** Settings → Compliance tab. Permission: `compliance:manage-rules`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-G1 | Add a required document type (e.g. "Police Check") | Saved; the dashboard's non-compliant count updates to include anyone missing it | |
| CV-G2 | Remove a required document type | Dashboard count updates accordingly | |

**Known gap:** there is no admin UI for the *expiry rules* themselves (how long a document type stays valid, which days to alert on) — only for which types are required. `GET`/`PUT /api/compliance/rules` are live and permission-gated but unreachable from the client; editing them today is a server-side operation. Do not file this as a bug.

### CV-H — Expiry scan and notifications

**What it does:** A daily job (05:00, once-per-day claim, no advisory lock) flips documents to `Expired` and sends renewal-reminder notifications at configured alert-day thresholds, resolved against the **venue's** jurisdiction, never the document's own `issuing_jurisdiction`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-H1 | Seed a document expiring exactly on an alert-day threshold, run the job (`ENABLE_SCHEDULED_JOBS=1`, or trigger manually in a dev script) | Exactly one renewal-reminder notification fires | |
| CV-H2 | Re-run the job the same day | No duplicate notification — `hasRecentNotification` suppresses the resend | |
| CV-H3 | Seed a document with `expiryDate` = today, run the job | Status flips to `Expired` | |
| CV-H4 | Check the job's heartbeat (`GET /api/compliance/stats`, admin) | Last-run timestamp is recent and advances only on success | |

**Automated coverage:** `complianceExpiryMath.test.ts` covers every branch of the decision tree (null expiry, expiry today, expiry past, alert-day boundary, no rule, rule not yet effective) as pure unit tests. `complianceExpiryJob.test.ts` and the integration suite cover the job's claim/retry/dedup behaviour, including two-concurrent-claims and crash-mid-scan-then-retry scenarios. Don't re-derive these manually — spot-check CV-H1–H4 is enough.

### CV-I — Audit-ready PDF export

**What it does:** A one-click, paginated PDF matching the dashboard's table, with an engagement-type column, printer-safe status pills.

**Where:** Team Compliance → Team tab, export button. Permission: `compliance:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-I1 | Export the PDF with a normal-sized staff list | Downloads; dated header with venue name and generation timestamp | |
| CV-I2 | Print the PDF in monochrome (or view it desaturated) | Status is still legible — pills use outline + text, never colour alone | |

### CV-J — Antoine (AI chat) compliance answers

**What it does:** Antoine can answer questions like "is Alex's RSA current?" through a tool that re-checks the caller's permission on every call (same source `requirePermission` uses, not a copy) and only ever relays a structured verdict — it never computes or infers a compliance status itself.

**Where:** Ask Antoine chat.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-J1 | Ask Antoine about your own compliance status | Answers using the real current status | |
| CV-J2 | As a non-manager, ask Antoine about a colleague's document status | Refused — logged as a forbidden attempt server-side | |
| CV-J3 | Ask Antoine about a person/document that doesn't exist | "I don't know" / not-found — never a fabricated status | |

**Automated coverage:** the deterministic half (forbidden → logged, absent → `{found:false}`) is integration-tested. The model's exact phrasing is manual QA only — this repo has no eval harness.

### CV-K — Retention and offboarding

**What it does:** Offboarding a staff member archives their documents immediately (signed-URL issuance refuses from that moment). A scheduled purge later deletes the row, the Cloudinary object, and its access-log rows once the retention window passes — 7 years from `employment_end_date` for employees (Fair Work record-keeping), a shorter configurable window for contractors/agency staff.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-K1 | Offboard a staff member (set an end date) | Their documents flip to `Archived`; attempting to view one immediately afterward is refused | |
| CV-K2 | Attempt to view an Archived document's signed URL | Denied, and logged as a denial in the access log | |

**Known gap:** this is exercised via `complianceRetentionService.test.ts` and is not wired to a one-click "offboard" button in the client yet — verify at the service/API level if there's no UI affordance for it in your build.

### CV-L — Access logging and rate limiting

**What it does:** Every signed-URL issuance is logged — granted and denied — and the issuance endpoint is rate-limited (it's both a Cloudinary-cost surface and an enumeration surface).

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-L1 | View your own document | A "granted" row appears in the access log | |
| CV-L2 | Attempt to view another staff member's document by guessing/editing a document id in the URL | 403, and a "denied" row appears in the access log | |
| CV-L3 | Request the same document's signed URL well past the URL's TTL (120 seconds) | The old URL 403s — TTL is enforced, not Cloudinary's default 1-hour window | |
| CV-L4 | Hammer the view-url endpoint rapidly | Rate-limited after the configured threshold | |

### CV-M — Permission boundaries (Phase 1)

| Permission | Grants |
|---|---|
| `compliance:read-own` | View/upload your own documents |
| `compliance:read-all` | View all staff documents + dashboard |
| `compliance:verify` | Approve/reject pending documents |
| `compliance:manage-rules` | Manage expiry rules + org-required document types |

| ID | Steps | Expected result | Result |
|---|---|---|---|
| CV-M1 | Hit any `/api/compliance/*` route with no auth token | 401 | |
| CV-M2 | Hit a `compliance:read-all` route holding only `compliance:read-own` | 403 | |
| CV-M3 | Hit any compliance route as Administrator, holding none of the specific keys | 200 — Administrator bypasses every check | |
| CV-M4 | Request another org's document by id | 404, not 403 — never confirms the id exists in another tenant | |

**Automated coverage:** every route × permission combination is covered in the compliance route test suite plus a dedicated org-A/org-B tenant-isolation canary (`compliance.tenant.integration.test.ts`). CV-M1–M4 above are spot checks, not the primary proof.

---

## Phase 2 — Roster Core

Links the vault to scheduling: a shift can only be assigned to someone holding every document their role requires, re-checked again at publish time because a certificate can lapse between drafting and publishing.

### RC-A — Roles

**What it does:** A role staff get scheduled into ("Bartender", "Line Cook"), org-wide or venue-scoped, with a set of required document types.

**Where:** Roster → Roles tab. Permission: `roster:read-all` to view, `roster:manage` to edit.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-A1 | Create a role, e.g. "Bartender" | Appears in the role list | |
| RC-A2 | Attach a required document type (e.g. "RSA") to the role | Saved — this is what `canAssign` checks against for anyone rostered into this role | |
| RC-A3 | Attempt to delete a role that has shifts scheduled against it | Blocked with a clear message | |
| RC-A4 | Delete an unused role | Removed | |

### RC-B — Shift builder

**What it does:** Create, edit, cancel shifts at a venue for a role and time window. Starts life as `Draft`.

**Where:** Roster → Shifts tab. Permission: `roster:manage`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-B1 | Create a shift for tomorrow, a role, a start/end time | Appears as `Draft` | |
| RC-B2 | Edit a Draft shift's time | Updates correctly | |
| RC-B3 | Cancel a shift | Status flips to `Cancelled`, drops off the active list | |
| RC-B4 | View shifts across a date range for a venue | Correctly filtered by venue and date | |

### RC-C — Assignment and the `canAssign` compliance gate

**What it does:** The core safety mechanism — a shift can't be assigned to someone missing, holding unverified, holding rejected, or holding an expired required document (when the jurisdiction's rule says expiry blocks rostering). The refusal names exactly who and why.

**Where:** Roster → Shifts tab, assign staff to a Draft shift.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-C1 | Assign a fully compliant staff member to a Draft shift | Succeeds, assignment starts `Pending` | |
| RC-C2 | Assign someone with an expired required document (where the rule blocks on expiry) | Refused: *"Cannot assign. {name}'s {document type} expired on {date}."* | |
| RC-C3 | Assign someone who never uploaded the required document type | Refused, naming the missing type | |
| RC-C4 | Assign someone whose required document is still Pending verification | Refused | |
| RC-C5 | Assign someone whose required document was Rejected | Refused | |
| RC-C6 | Assign the same person to the same shift twice | Blocked — one assignment per (shift, person) | |
| RC-C7 | Assign staff to an already-Published shift directly (not via swap) | Blocked — only a Draft shift can gain a new assignee this way | |
| RC-C8 | Remove an assignment | Removed cleanly, audit-logged | |

**Automated coverage:** `rosterAssignmentRules.test.ts` — the full ten-case status × block-on-expiry truth table as pure unit tests. RC-C1–C6 above are the click-through proof the wiring actually uses that logic.

### RC-D — My Shifts (staff self-service)

**What it does:** A staff member sees their own upcoming shifts and confirms or declines anything still Pending.

**Where:** Roster → My Shifts tab. Permission: `roster:read-own`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-D1 | Open My Shifts with zero shifts assigned | "No shifts yet" empty state | |
| RC-D2 | View a Pending shift | Confirm / Decline buttons visible | |
| RC-D3 | Confirm a Pending shift | Status flips to `Confirmed` | |
| RC-D4 | Decline a Pending shift | Status flips to `Declined` | |
| RC-D5 | Try to respond to an already-responded assignment again | Blocked (409) | |

### RC-E — Staff availability

**What it does:** Recurring day-of-week windows a staff member is available, for a manager's reference when building the roster.

**Where:** Roster → My Availability tab. Permission: `roster:read-own` (own), `roster:read-all` (org-wide view).

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-E1 | Add an availability window (e.g. Monday 9am–5pm) | Saved | |
| RC-E2 | Edit a window's times | Updates | |
| RC-E3 | Delete a window | Removed | |
| RC-E4 | As a manager, view org-wide availability | Sees every staff member's windows, not just your own | |

### RC-F — Publish and the Award engine coverage disclosure

**What it does:** Publishing moves every Draft shift in a date range live, re-checking `canAssign` for every existing assignment at that exact moment (a certificate can lapse between draft and publish). A shift that now fails is *held back*, not blocking the whole batch. Every publish also runs the Award engine — advisory-only, never blocks — and **always** shows the coverage line, whether or not any warnings exist.

**Where:** Roster → Shifts tab, Publish action. Permission: `roster:publish`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-F1 | Publish a range where every assignment is currently compliant | All shifts move to `Published` | |
| RC-F2 | Between drafting and publishing, let one assignee's document expire, then publish | That one shift is held back (stays Draft) with a named reason; the rest of the batch still publishes | |
| RC-F3 | Publish with zero `award_rule` rows configured (the current real state) | Screen shows **"0 of N rule categories checked"** with the same visual weight a populated warning list would get — never silently omitted | |
| RC-F4 | Publishing with outstanding Award warnings (only reachable once rules exist) | Requires an explicit operator acknowledgement before publishing proceeds; the ack is written to the audit log with the warnings and coverage object | |

**Known gap:** `award_rule` has zero rows seeded anywhere — nobody is currently named as competent to author Fair Work Award rules. This is deliberate (see [Known Limitations](#known-limitations)), so RC-F4 is not currently reachable in this build. Verify RC-F3 instead as proof the disclosure mechanism itself works.

### RC-G — Public holiday calendar

**What it does:** Fail-loud, not silent — publishing into a jurisdiction/year with no loaded public holiday calendar is *blocked* outright, because a missing year would otherwise mean s.114 consent silently never fires for that year's holidays.

**Where:** Settings → Public Holidays tab (admin loader). Permission: `roster:manage`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-G1 | Load a public holiday (jurisdiction, date, name) for the current year | Saved | |
| RC-G2 | Publish a roster whose date range falls in a year with NO holidays loaded for that jurisdiction | Blocked outright: *"Public holidays for {jurisdiction} {year} are not loaded."* — the entire publish, not per-shift | |
| RC-G3 | Load the missing year, retry the publish | Succeeds | |
| RC-G4 | Publish a shift that lands exactly on a loaded holiday date | `shift.isPublicHoliday` is set true on that shift | |
| RC-G5 | Delete a loaded public holiday | Removed; a second delete on the same id 404s | |

### RC-H — s.114 public holiday consent

**What it does:** A shift landing on a public holiday needs the assignee's explicit consent before it can be published — a separate question from "will you work this shift." Declines are never silently overridden.

**Where:** Manager triggers from the Shifts tab (`roster:manage`); staff respond in My Shifts (`roster:read-own`).

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-H1 | As a manager, request consent for an assignee on a public-holiday shift | Assignee gets a notification; their `publicHolidayConsent` flips to `Requested` | |
| RC-H2 | As the assignee, open My Shifts | A distinct Accept/Decline banner appears, separate from the ordinary shift Confirm/Decline question | |
| RC-H3 | Accept the consent request | Flips to `Accepted`; publishing that shift is no longer held on this reason | |
| RC-H4 | Decline the consent request | Flips to `Declined`; a manager is notified (`notifyHQAdmins`) so they know to reassign | |
| RC-H5 | Publish a roster with a public-holiday shift nobody has responded to yet | That shift is held back with a named reason ("hasn't responded to the public holiday consent request yet"); the rest of the roster publishes | |
| RC-H6 | Publish a roster with a declined public-holiday shift | Held back, reason names the decline — never silently overridden | |
| RC-H7 | Try to re-request consent on an already-Accepted assignment | Refused (409) | |
| RC-H8 | Try to respond to a consent request as someone other than the assignee | 404 — never confirms another user's assignment exists | |

### RC-I — Timezone correctness (spot check)

**What it does:** Every date shown to a user or checked against the holiday calendar is computed in the **venue's** local calendar day, not the server's UTC day — this bug class has bitten this codebase multiple times, so it's worth a direct spot check.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-I1 | Create a shift that starts in the early morning at a venue (e.g. 5am local), where that instant is still the *previous* UTC calendar day | The shift correctly shows on the venue's local date, not the UTC-shifted one, everywhere it's displayed or checked against the holiday calendar | |

### RC-J — Permission boundaries (Phase 2)

| Permission | Grants |
|---|---|
| `roster:read-own` | Your own shifts, availability, respond/consent actions |
| `roster:read-all` | Org-wide shifts, roles, availability |
| `roster:manage` | Create/edit roles, shifts, assignments, public holidays |
| `roster:publish` | Publish a roster |

| ID | Steps | Expected result | Result |
|---|---|---|---|
| RC-J1 | Hit any `/api/roster/*` route with no auth token | 401 | |
| RC-J2 | Attempt to assign staff or publish holding only `roster:read-own` | 403 | |
| RC-J3 | Hit any roster route as Administrator | 200 regardless of specific keys held | |
| RC-J4 | Request a shift/role/assignment belonging to another org | 404 | |

**Automated coverage:** `rosterPermissions.test.ts` covers every route; `roster.tenant.integration.test.ts` is the org-A/org-B canary.

---

## Phase 3 — Workforce Optimisation

Uses signals CulinAIre already has (prep workload, existing compliance data) to answer "how many people do I need" and "is my roster actually covered" — plus a peer-to-peer shift swap marketplace.

### WO-A — Demand forecasting

**What it does:** Recommends staffing hours per kitchen station (not per role — no mapping exists between prep-task stations and roster roles, by design) for a target date, from historical prep workload scaled by that date's expected covers. Discloses exactly what data it did and didn't use.

**Where:** Roster → Demand tab. Permission: `roster:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-A1 | Pick a venue + a date that has a prep session with expected covers, and 30 days of prior prep history | Shows recommended hours per station with a confidence percentage | |
| WO-A2 | Pick a date with NO prep session / no expected-covers count | Fails loud: a clear 404-style message, not a guessed number | |
| WO-A3 | Pick a station with only occasional historical data vs. one logged daily | The occasional one shows visibly lower confidence | |
| WO-A4 | Check what inputs the result discloses | Explicitly lists what was used (prep task minutes, covers) and what wasn't (`sale` data) — never silently omitted | |

### WO-B — Coverage heat map

**What it does:** A day × role grid for one venue over a date range — cell = rostered hours for that role that day, coloured by the worst compliance status among its assignees (reusing the exact `canAssign` gate, not a separate check).

**Where:** Roster → Coverage tab. Permission: `roster:read-all`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-B1 | View coverage for a venue/week with a mix of covered, understaffed, and skill-gap shifts | Grid renders with distinct colours per status; a (day, role) with no shift at all shows as an empty placeholder, distinct from "unstaffed" | |
| WO-B2 | Hover/click a cell with a compliance gap | Detail text matches the exact refusal wording `canAssign` would give live (e.g. "Cannot assign. Alex's RSA expired on...") | |
| WO-B3 | Check the summary stat row above the grid | Numbers reconcile exactly against what the grid itself shows — same anti-drift discipline as the compliance dashboard | |
| WO-B4 | Put two assignees on the same shift | That shift's hours count once in the grid, not once per assignee | |

**Known gap:** the heat map doesn't resolve a per-venue jurisdiction override for expiry rules the way `publishRoster()` does — every role falls back to the national rule. Acceptable for an advisory heat map; worth revisiting only if it turns out to matter in practice.

### WO-C — Shift swap

**What it does:** A staff member offers a `Confirmed` shift they hold; any other staff member browses open offers and self-claims one — no manager approval step, gated only by re-running `canAssign` against the claiming candidate. Claiming into a public-holiday shift resets consent to `Requested` for the new person; they never inherit the old assignee's answer.

**Where:** Roster → My Shifts tab — "Offer to swap" button on Confirmed rows, "Open swaps" list below. Permission: `roster:read-own`.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-C1 | Offer a Confirmed shift for swap | Button flips to "Cancel swap offer"; the offer appears in every other org member's "Open swaps" list | |
| WO-C2 | Try to offer a Pending (not yet Confirmed) shift | Blocked (409) | |
| WO-C3 | Try to offer the same shift twice | Second attempt blocked: "This shift is already offered for swap" | |
| WO-C4 | As the offerer, try to claim your own open offer | Blocked: "You can't claim your own swap offer" | |
| WO-C5 | As a compliant staff member, claim someone else's open offer | Succeeds — the old assignment disappears, a new `Confirmed` assignment appears under the claimer, the offer drops off everyone's list | |
| WO-C6 | As a staff member missing the role's required document, attempt to claim | Blocked with the same wording a live `assignStaff` refusal would give | |
| WO-C7 | Claim an offer on a public-holiday shift | The new assignment starts with `publicHolidayConsent = "Requested"` — the standard Accept/Decline banner appears for the new person, never pre-answered | |
| WO-C8 | Cancel your own still-open offer | Removed from every list; the original assignment is untouched | |
| WO-C9 | Try to cancel someone else's open offer | 404 — never confirms it exists | |
| WO-C10 | Two people attempt to claim the same open offer at (as close to) the same instant | Exactly one succeeds; the other gets "This swap was just claimed by someone else" | |

**Automated coverage:** the concurrent-claim race (WO-C10) is proven against the real database under genuine concurrency in `shiftSwap.integration.test.ts`, not simulated — worth trusting that result rather than trying to reproduce true concurrency by hand in the UI.

### WO-D — Permission boundaries (Phase 3)

No new permission keys — everything reuses `roster:read-own` / `roster:read-all` from Phase 2.

| ID | Steps | Expected result | Result |
|---|---|---|---|
| WO-D1 | Hit any `/api/workforce/*` route with no auth token | 401 | |
| WO-D2 | Attempt demand/coverage holding only `roster:read-own` | 403 (these two need `roster:read-all`) | |
| WO-D3 | Attempt a swap action (offer/claim/cancel) holding only `roster:read-own` | 200 — this tier is deliberately enough for self-service swap | |
| WO-D4 | Request another org's swap by id | 404 | |

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
| Phase 1 — Compliance Vault | | | |
| Phase 2 — Roster Core | | | |
| Phase 3 — Workforce Optimisation | | | |
