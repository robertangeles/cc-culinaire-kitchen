# The Brain — Prod Activation Checklist (operator)

What **you** do to turn the Brain on in production, one flag at a time, with a
verify and a rollback at every step. The feature is deployed and inert (all
`brain_*` flags `false`). Nothing here is urgent — activate when the gates pass.

## How you flip a flag (read once)

**Primary path — the admin Brain tab.** Log into
**https://www.culinaire.kitchen as an admin → Settings → Brain**. Each flag is a
live toggle; flipping one writes it immediately (the settings cache is
invalidated) and the panel shows a health readout (ready / pending / failed
counts, memories/day, capture counters). Every toggle is instantly reversible.

**Fallback — authenticated `PUT /api/settings`.** If you ever need it without the
UI, run this in the browser devtools console while logged in as admin (reuses
your session cookie, hits the same cache-invalidating endpoint):
```js
fetch('/api/settings', {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  credentials: 'include', body: JSON.stringify({ /* flags */ })
}).then(r => r.json()).then(console.log)   // {success:true}
```
A raw SQL update would NOT take effect until a server restart — always go through
the tab or this endpoint.

---

## Phase A — Pre-activation gates (BOTH must pass before any flag flips)

| # | What you do | Pass condition |
|---|---|---|
| ☐ A1 | Log into www.culinaire.kitchen as admin → click **Your Brain** in the sidebar | Warm **"Your Brain is warming up"** empty state loads, no error. (Confirms the read path + table work in prod.) |
| ☐ A2 | Wire a **log alert** in Render (or your log aggregator) that fires on the string `"alert":"brain_capture_error"` in the server logs | Alert exists and you've test-fired it. **This is the spec's Phase-1 exit criterion** — capture swallows its own errors, so a silently-broken capture looks healthy without this alarm. |

Do not proceed past A until both are ticked.

---

## Phase B — Enable capture

| # | What you do | Verify | Rollback |
|---|---|---|---|
| ☐ B1 | Devtools: `body: JSON.stringify({ brain_enabled:'true', brain_capture_enabled:'true' })` | `{success:true}` | set both back to `'false'` |
| ☐ B2 | Have a real user (or you) send a normal chat message on the site | Within ~30s, a memory appears: ask me to run `SELECT count(*), status FROM brain_memory GROUP BY status;` against prod — count > 0, rows moving `pending → ready`. Render logs show `brain.capture.recorded` then `brain.worker.tick`. | — |
| ☐ B3 | Watch for ~a day | No `brain_capture_error` alerts; queue not stuck in `pending` (worker embedding is healthy) | if errors: flip capture `false`, investigate |

Let capture warm the corpus for a bit before turning on recall — recall over an empty Brain does nothing useful.

---

## Phase C — Enable distillation (recommended, optional)

Turns on the Balanced noise filter so retrieval questions / chit-chat don't get stored.

| # | What you do | Verify | Rollback |
|---|---|---|---|
| ☐ C1 | Devtools: `body: JSON.stringify({ brain_distillation_enabled:'true' })` | `{success:true}` | set `'false'` → back to raw capture |
| ☐ C2 | Send a pure question ("what's my pasta ratio?") vs. a statement ("my pasta ratio is 100g/egg") | Question is NOT stored (Render log `brain.capture.distill_skip`); statement IS stored | — |

Cost note: one cheap `claude-haiku-4-5` call per captured chat turn while on.

---

## Phase D — Enable recall

| # | What you do | Verify | Rollback |
|---|---|---|---|
| ☐ D0 | Pre-check: confirm the active `systemPrompt` still contains `{{KITCHEN_CONTEXT}}` (ask me to check prod) | placeholder present (else the block appends to prompt end — still works, just know it) | — |
| ☐ D1 | Devtools: `body: JSON.stringify({ brain_recall_enabled:'true' })` | `{success:true}` | set `'false'` |
| ☐ D2 | In a NEW conversation, ask something referencing an earlier stored memory | Answer reflects the memory + a dismissible **"Grounded in your Brain"** chip appears; Render log `brain.recall.hit` | — |

---

## After all four: it's live

Capture + distillation + recall on, chat grounded in each user's own history.
Everything is still flag-reversible with no deploy. Phase 2 (org tier, ops-event
capture, Labs/Copilot recall) is separate future work.

## Rollback summary
- **Any stage:** flip that flag `false` in **Settings → Brain** — instant, no deploy.
- **Kill everything:** flip the master **Brain (master)** toggle off — disables capture, recall, and the worker in one click.
- **Code-level:** `git revert` the merge; the empty `brain_memory` table can stay.

## What I can do for you at each step
I can't flip prod flags (no prod admin token; that's your Settings → Brain action),
but I *can* run read-only prod checks on demand: memory counts by status, worker
queue depth, distill-skip confirmation, and the `{{KITCHEN_CONTEXT}}` placeholder
check. Just ask at each phase.
