# The Brain — Co-working Session Handoff (2026-07-08)

Point-in-time snapshot of a single session that carried The Brain from Phase-1
(live) through most of Phase 2. The living plan/status is `brain-memory.md` +
`brain-memory-status.md`; this file is the "what happened today + what's loose"
note for the next session.

---

## What was built (this session)

| Task | What it does | State |
|---|---|---|
| **T11 — Org tier** | Per-org shared memory recall + management; active-org resolver with live-membership recheck; hard tenant isolation. | ✅ **Merged (PR #46) + deployed**; prod DB migrated. |
| **T12 — Ops-event capture** | Brain remembers what the kitchen *does* (PO/waste/stock/prep/recipe/menu) via `recordOpsEvent` deterministic templates (no LLM distiller). | ✅ **Merged (PR #46) + deployed.** |
| **T13 — Recall in the Labs** | Recipe/Patisserie/Spirits generation + refinement grounded in Brain memory. | ✅ **Merged (PR #46) + deployed.** |
| **T14 slice 1 — Labs grounded chip** | The "Grounded in your Brain" chip now shows on Lab results. | 🔵 **Branch + PR #47** (open, not merged). |
| **T14b — Rich Your Brain controls** | Pin / correct(→re-embed) / scope-toggle + scope tabs + source-filter chips. | 🔵 **Branch + PR #48** (open, not merged). |

**Verification at handoff:** server 544/544, client 58/58, lint 0 errors, build
3/3, tsc clean. Every task also had a real-stack live smoke (org canaries; live
waste capture; grounded generation; live PATCH pin/correct/scope with a real
worker re-embed).

**Prod:** T11–T13 live and healthy (post-deploy canary 5/5). Features ride the
existing prod flags (`brain_enabled`/`brain_capture_enabled`/`brain_recall_enabled`,
already on); kill switch is `brain_enabled`.

---

## Open PRs (need CI → review → merge)

- **PR #47** — `feature/ck-web/brain-labs-chip` (T14 slice 1). No migration.
- **PR #48** — `feature/ck-web/brain-your-brain-controls` (T14b). **Has a prod migration.**

Both edit `docs/specs/brain-memory-status.md` in the same T14 section → **expect a
trivial doc-merge conflict** between them; resolve at the second merge.

---

## What remains (Phase 2 → Phase 3)

- **T14c — Org-admin management surface** ← next. Browse/correct/delete *other
  members'* shared memories under an admin view + org attribution on
  `ProvenanceChip`. Reuses the T14b endpoints (`canManage` already gates org-admins).
- **T15 — Org digest.** Periodic "what your kitchen's Brain learned" summary
  (`brainDigestService`, `pg_advisory_lock`-guarded).
- **Phase 3** — T16 compaction + full distiller (adds `last_recalled_dttm`);
  T17 proactive nudges (`brain_nudges_enabled` seeded off); T18 ranking tuning +
  admin re-embed panel + dashboards.

---

## Cleanup / loose ends

1. **Prod migration for PR #48 (T14b).** Before #48 deploys, run
   `scripts/addBrainPinColumn.ts` on prod (adds `is_pinned` + partial index;
   additive/idempotent) — **backup-first**, same flow as T11. #47 needs no migration.
2. **Secure/delete the local prod backup.** `~/culinaire-prod-backups/culinaire-prod-20260708-152011.sql`
   (169 MB, contains encrypted credentials + PII, `chmod 600`) — the pre-T11-migration
   restore point. Delete or move to secure storage; never let it near git.
3. **Central backup repository (parked).** There is no owned, off-Render, scheduled
   backup. Render's own daily backups likely exist (confirm in the dashboard). Agreed
   to tackle after this build — a scheduled `pg_dump → cloud bucket` with retention.
4. **Doc-merge conflict** between #47 and #48 in `brain-memory-status.md` (see above).
5. **Accepted limitations (not bugs, just noted):**
   - **Recipes are user-scoped** (recipe table has no org column) — a chef's recipe
     history doesn't reach colleagues. Org-scoping recipes = a schema migration.
   - **Copilot recall deferred** — the prep module has no LLM step to ground; wire it
     if/when prep gains AI generation.
   - **T12 PO multi-line receive** upserts one `${poId}:received` memory (last-wins);
     per-line granularity is a future option.
   - **Scope-toggle multi-org promote** uses the user's active org (no org picker);
     a picker is a future refinement. Once shared, only an org-admin can un-share
     (deliberate org-governance choice — the author alone cannot).

---

## Fast resume for next session
1. Land #47 and #48 (CI → review → merge; resolve the doc conflict; run
   `addBrainPinColumn.ts` on prod before #48 deploys, backup-first).
2. Then either **T14c** (org-admin surface) or the **central backup repository**.
