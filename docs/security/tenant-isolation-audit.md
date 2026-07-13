# Tenant-Isolation Red-Team Audit — 2026-07-13

> **STATUS: FULLY REMEDIATED (local).** All 49 holes (48 audit findings + the
> original catalog leak) fixed and verified — tsc clean, full server suite (574
> tests) green, and live cross-org probes on each domain. Delivered across 6
> branches (each its own PR):
>
> | Branch | Findings |
> |---|---|
> | `fix/ck-web/tenant-isolation-p0-criticals` | catalog list + org-takeover + this ledger |
> | `fix/ck-web/tenant-isolation-inventory` | A1–A11 |
> | `fix/ck-web/tenant-isolation-purchasing` | B1–B14 |
> | `fix/ck-web/tenant-isolation-menu-stocktake` | C1–C12 |
> | `fix/ck-web/tenant-isolation-bench` | E2–E8 |
> | `fix/ck-web/tenant-isolation-conversations-identity` | E1, D2, D3 |
>
> Prod exposure assessment: **DONE** — see `prod-exposure-check.md` (0/22
> contamination detectors, no breach evidence). Still recommended: real-DB
> integration boundary tests (403 cross-tenant) per the repo checklist — the
> current suite mocks the DB, so these fixes were proven via live probes instead.

**Trigger:** rob.angeles@culinaire.kitchen (org 2, Almost French Pâtisserie) saw
55 catalog items in Stock Room → Catalog on localhost. Org 2 has 0 ingredients
locally; the 55 belong to org 1 (Comfort Spoon Co.). Root cause: a dropped org
filter. A full audit of every org-scoped endpoint followed.

**Verdict:** Multi-tenant isolation has **systemic** gaps — ~48 confirmed
cross-tenant holes across inventory, purchasing/receiving, menu/recipe,
stock-take, community (Bench), and org-management. The common root cause: newer
Stock Room / Purchasing / Menu endpoints fetch or mutate a resource **by id
alone**, without threading the caller's org through the controller → service and
checking it. The earlier endpoints (`getIngredient(id, orgId)`, PO detail,
transfers) do this correctly.

**Data classes at risk:** ingredient costs/suppliers, PO totals & approvals,
receiving evidence & credit notes, costed recipe IP & margins, stock levels,
Bench messages, and — worst — **org join keys + decrypted member PII** (full
tenant takeover).

## Fix patterns (all 48 collapse to 3)

- **A — IDOR by id:** thread `orgId` (or `userId` for user-owned rows) into the
  service; add `AND organisation_id = :orgId` to the by-id WHERE, or a preflight
  ownership fetch (e.g. `getIngredient(id, orgId)`), 403/404 on mismatch.
- **B — Dropped list filter:** add `eq(table.organisationId, orgId)` to the
  query; validate any client-supplied `storeLocationId` belongs to `orgId`.
- **C — Client-org trust:** never take org/location from the request as trusted
  scope — derive org from `getUserLocationContext` membership and validate the
  supplied location against it.

---

## FIXED (verified)

| # | Sev | Location | Fix |
|---|-----|----------|-----|
| F0 | CRIT | `ingredientService.listIngredients` | Single `and(...conds)`; org filter can no longer be overwritten. Regression test `ingredientService.tenant.test.ts`. Proven: `listIngredients(2)` 55→0. |
| D1 | CRIT | `organisationController.handleGetOrganisation` | Added `getMembership` gate before returning join_key + org PII. Blocks org-id enumeration → takeover. |

---

## FIXED — CRITICAL (cross-tenant read/write of another tenant's data)

Inventory (controllers/ingredientController.ts, services/ingredientService.ts):
- **A1** `handleDeleteConversion` → `deleteUnitConversion(conversionId)` — deletes any org's unit conversion by uuid. *A*
- **A2** `handleUpdateLocationIngredient` → `updateLocationIngredient` — upserts any org's location_ingredient (par/cost/preferred supplier). *A*
- **A3** `handleAssignSupplier` → `assignSupplierToIngredient` — links supplier↔ingredient across orgs. *A*
- **A4** `handleUpdateIngredientSupplier` — overwrites another org's supplier cost/preferred flag. *A*
- **A5** `handleRemoveIngredientSupplier` — soft-deletes another org's supplier link. *A*

Purchasing / Receiving (controllers/{purchaseOrder,receiving}Controller.ts, services/{purchaseOrder,receiving,pdf}Service):
- **B1** `receiveLine(poId)` — receive against another org's PO (FIFO + stock mutation). *A*
- **B2** `handleStartSession` → `startSession(poId)` — hijack another org's SENT PO. *A*
- **B3** `handleGetSession` → `getSession(sessionId)` — read another org's full receiving record + photos. *A*
- **B4** `handleActionLine` — mark another org's delivery lines rejected/short. *A*
- **B5** `handleConfirmReceipt` — commit another org's receiving (stock + PO close). *A*
- **B6** `handleCancelSession` — cancel another org's receiving session. *A*
- **B7** `handleDownloadPOPdf` → `generatePOPdf(poId)` — download any org's PO PDF (supplier prices, totals). *A*

Menu Intelligence (controllers/menuIntelligenceController.ts, services/menuIntelligenceService.ts) — note: scoped by `userId`, integer PKs are sequential/brute-forceable:
- **C1** `handleAddIngredient` → `addIngredient` — inject ingredient into another user's menu item. *A*
- **C2** `handleGetPandLCost` → `getPandLFoodCost` — read another user's per-location WAC food cost. *A*
- **C3** `handleDeleteIngredient` → `deleteIngredient` — delete another user's menu-item ingredients. *A*
- **C4** `handleListIngredients` → `getIngredients` — read another user's full costed recipe. *A*
- **C5** `handleRefreshCost` → `refreshIngredientCost` — mutate another user's ingredient cost; also final `db.update` drops the `menuItemId` filter. *A*

Stock Take (controllers/stockTakeController.ts, services/stockTakeService.ts):
- **C6** `handleApproveSession` → `approveSession(sessionId)` — approve another org's stock take, overwriting their live stock_level. *A*

---

## FIXED — HIGH

Inventory reads:
- **A6** `handleListIngredientSuppliers(id)` — read another org's supplier terms. *A*
- **A7** `handleGetSupplierLocations(id)` — read another org's supplier→location map. *A*
- **A8** `handleGetSupplierIngredientIds(supplierId)` — enumerate another org's ingredient uuids. *A*
- **A9** `getIngredientUsage(ingredientId)` (GET usage + pre-delete 409 body) — leak another org's menu item names. *A*
- **A10** `setSupplierLocations(locationIds)` — attach another org's location to a supplier (client-supplied ids). *A/C*

Purchasing dropped-filters (client-supplied storeLocationId, no org filter):
- **B8** `createCreditNote(discrepancyId)` — resolve/credit another org's discrepancy (table lacks org col; join PO). *A*
- **B9** `getSuggestions(locationId, orgId)` — `orgId` param ignored; returns another org's stock-vs-par. *B/C*
- **B10** `listConsumptionLogs(storeLocationId)` — another org's consumption logs. *B/C*
- **B11** `listPendingTransfers(storeLocationId)` — another org's inbound transfers. *B/C*
- **B12** `listRecommendations(storeLocationId)` — another org's AI forecasts. *B/C*

Menu / Stock Take state machine:
- **C7** `handleSubmitForReview(sessionId)` — OPENING session auto-approve writes another org's stock + activates location. *A*
- **C8** `handleClaimCategory` — claim/lock a category in another org's session. *A*
- **C9** `handleSubmitCategory` — auto-advance another org's session to review. *A*
- **C10** `handleFlagSession` — flag/block another org's session indefinitely. *A*

Users:
- **D2** `PATCH /users/:id` (`adminUpdateUser`) — gated by delegable `admin:manage-users`, no org scope; a delegated non-admin can edit any tenant's user PII. Fix: `requireRole("Administrator")` or org-membership check. *A*

Bench (controllers/benchController.ts, services/benchService.ts):
- **E2** `handleGetPins` — read pins of an org channel you're not in. *B*
- **E3** `handleSearchMessages` — search another org's channel history. *B*
- **E4** `handlePinMessage` — pin into another org's channel. *B*
- **E5** `handleUnpinMessage` → `unpinMessage(messageId)` — unconditional delete of any pin. *A*

---

## FIXED — MEDIUM

- **B13** `forecastService.generateForecasts` delete block — deletes another org's ACTIVE forecasts (client-supplied locationId). *B/C*
- **B14** `getCreditNotesForSupplier(supplierId)` — org filter bypassed when supplierId supplied. *A*
- **C11** `getLocationDashboard(locId)` — leaks another org's location status/activation/session existence (stock is filtered; these 3 subqueries aren't). *A/B*
- **E6** `benchSocketService` `bench:reaction:add/remove` — react to a message in a channel you can't access. *A*

## FIXED — LOW

- **A11** `ingredientAliasController.createAlias` — create an alias on another org's ingredient (list read is post-filtered, so read is safe; write isn't). *A*
- **C12** `recipePersistenceService.updateRecipe` — `isPublicInd`-only fallback bypasses ownership; guest/cross-org can publish a private recipe by uuid. *C*
- **D3** `handleUpdateModulePreference` — writes a location preference without `hasLocationAccess` (sibling `handleSwitchLocation` checks it). Defense-in-depth. *C*
- **E7** `benchSocketService` `bench:typing` — broadcast typing into an org channel you're not in. *B*
- **E8** `benchSocketService` `bench:join` `dm_*` — join a DM room you're not part of (no content leaks today). *A*

---

## Confirmed CLEAN

Org-switch (`activeOrgService`: re-checks live membership), `getUserLocationContext`,
credentials/roles/permissions/settings (Administrator-only by design), Brain
memory (row-lock + `canManage`), notifications (`recipientUserId`), conversation
read/list/delete, waste, prep, and the correctly-guarded PO/transfer/stock-take
read paths. See per-domain "CLEAN" lists in the audit run.

## Remediation notes

- Per repo checklist, each fix needs a boundary test: 403 without org, 200 with,
  401 no token, admin passes.
- Same code is deployed to prod — prod runs these same handlers. A read-only prod
  exposure check (tenant count, cross-tenant data overlap) is recommended but was
  deliberately deferred (local-only this session).
- `menu_item_ingredient` uses a **sequential integer PK** → C1–C5 are
  brute-forceable without knowing a uuid. Prioritise alongside the CRITICALs.
