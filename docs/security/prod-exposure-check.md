# Production Exposure Check — Tenant Isolation — 2026-07-13

Read-only forensic assessment of the **production** database, run after the
tenant-isolation audit, to answer one question: **did any of the 49 cross-tenant
holes actually result in a data breach in prod?**

Method: a single read-only session (`default_transaction_read_only = on`), 22
contamination detectors (one per vulnerable relationship) plus an identity and
data-ownership profile. No writes, no schema changes.

Isolation model under test (per product design): **user-first, then
organisation** — user-owned resources (menu items, recipes, conversations,
messages) belong to a `user_id`; org-shared resources (ingredients, suppliers,
locations, POs, stock, org Bench channels) belong to an `organisation_id`; every
cross-link must respect those boundaries and every user action in an org context
requires membership.

## Result: NO EVIDENCE OF A BREACH

### 1. Zero cross-tenant data contamination — 22/22 detectors returned 0

Every relationship that a write-side IDOR could have corrupted was checked for
rows that cross an org (or user→org) boundary. **All zero:**

- Inventory: ingredient↔supplier, ingredient_alias, location_ingredient,
  supplier_location, stock_level, fifo_batch — 0 cross-org rows.
- Menu (user-first): no menu_item_ingredient links an ingredient to an org the
  item's **owner** isn't a member of; no menu item pins a location outside the
  owner's orgs — 0.
- Purchasing: PO lines (incl. substitutions), receiving sessions, credit notes,
  transfers, consumption logs, forecasts — 0 cross-org rows.
- Stock-take: sessions vs location org, line ingredients vs session org — 0.
- Bench: no message / pin / reaction in an organisation channel by a
  non-member — 0.
- Conversations: no owner-less, guest-less orphan rows — 0.

**Interpretation:** the write-side IDOR vulnerabilities (create/mutate another
tenant's rows) were **never exploited** — no bad cross-tenant data exists.

### 2. There is no third-party tenant whose data could have crossed

Production holds **2 organisations, 7 users, 4 org memberships, 0 users in more
than one org**:

- **Both organisations are company-internal.** Org 1 is the founder's; org 2 is
  the founder plus one colleague, all on the company's own domain / the founder's
  personal emails. There is **no external customer organisation**.
- **Only org 1 holds catalog data** (55 ingredients, 5 suppliers); org 2 has 6
  suppliers and **0 ingredients / 0 menu items**. The catalog read-leak's only
  possible payload was the founder's own demo catalog.
- The remaining registered accounts (a QA test user and 2 external sign-ups) are
  **members of no organisation** — their only data is their own Chat Assistant
  conversations. Conversation/message **read** paths were never vulnerable (they
  were correctly `user_id`-scoped), so their personal chat content was never
  exposable to others.

**Interpretation:** the org-scoped **read** leaks (catalog list, PO PDF, etc.)
leave no data trace, so exploitation can't be disproved forensically — but with
the current data there was **no external-tenant-to-external-tenant exposure
possible**: the only "other tenant" is the company itself.

### 3. Residual: the org-enumeration PII window (now closed)

The one hole reachable by **any** logged-in account — including the 2 external
sign-ups — was `GET /organisations/:id` (D1): org-id enumeration → join key +
decrypted **member** name/email. Exposed set = the **4 internal org members'**
names/emails + join keys. This is a small, internal PII set; `audit_log` is empty
and reads aren't logged, so access can't be confirmed or denied — but the blast
radius is 4 internal people, and the hole is **fixed**.

## Bottom line for liability

- **No cross-tenant data was ever written** (0/22 contamination).
- **No external customer tenant exists**, so no third party's data was exposed to
  another third party.
- The fixes land **before** real external kitchens are onboarded — which is the
  point at which these holes would have become genuine multi-tenant breaches.
- Closed the only real-world PII window (D1) with no evidence it was used.

## Recommendations

1. Merge all six remediation PRs before onboarding any external tenant. **Do not
   onboard a second real organisation until they are deployed.**
2. Enable write **and** sensitive-read auditing (the `audit_log` table exists but
   is empty) so future access is provable.
3. Add the integration boundary tests (403 cross-tenant) as the durable guard.
4. Re-run this exposure check (script in the security scratchpad) after the first
   real external tenant onboards, as a periodic control.
