# Recipe Lab → Catalog Ingredient Matching

Planning artifacts for closing the gap where Recipe Lab–generated ingredient
strings (chef-narrative like `"flat-leaf parsley, leaves only, roughly chopped"`)
fail to match the canonical Catalog (`Parsley`) — causing every downstream
operations module to show $0.00.

## Files

- **[design.md](design.md)** — `/office-hours` design doc. Problem statement,
  demand evidence, status quo, target persona, premises, three implementation
  approaches, recommended approach (B), Apple-style UX north star, the
  assignment.
- **[ceo-plan.md](ceo-plan.md)** — `/plan-ceo-review` Step 0D-POST artifact.
  Vision (10x + platonic ideal), scope decisions, accepted scope, deferred
  to TODOS, critical gaps, the assignment.
- **[ceo-review-full.md](ceo-review-full.md)** — full 11-section CEO review
  (SCOPE EXPANSION mode): architecture diagrams, error/rescue map, security,
  data flow, tests, perf, observability, deploy/rollout, long-term, design.
  All findings + 4 CRITICAL GAPS flagged.

## Status

- ✅ `/office-hours` complete (design doc)
- ✅ `/plan-ceo-review` complete (SCOPE EXPANSION; 1 expansion accepted, 4 deferred)
- ⏭ `/plan-eng-review` required next (architecture pressure-test)
- ⏭ `/plan-design-review` recommended (Apple north star deserves designer eye)
- ⏭ Implementation on a feature branch following Approach B + Expansion #1

## To resume from another machine

1. `git pull` to get this branch + the FK fix branch (`fix/ck-web/recipe-purge-fk-cascade`)
2. Read `design.md` → `ceo-plan.md` → `ceo-review-full.md` (15-20 min)
3. Start a fresh Claude Code session: "resume work on Recipe Lab → Catalog matching;
   context is in docs/specs/recipe-lab-catalog-matching/. Run /plan-eng-review next."
