---
title: CI Pipeline (GitHub Actions)
category: decision
created: 2026-04-29
updated: 2026-04-29
related: [[technical-architecture]], [[culinaire-kitchen-platform]]
---

Wire up the GitHub Actions CI pipeline that CLAUDE.md has been describing all along but that didn't exist on disk. Every push and PR to `main` now runs install → lint → typecheck → test → build before merge.

## Source of truth (workflow file)
[.github/workflows/ci.yml](../../.github/workflows/ci.yml)

## Status
Active as of 2026-04-29.

## Why this exists
On 2026-04-29 a Render deploy failed with a TS2493 in `packages/server/src/middleware/rateLimiter.test.ts`. The test file had landed via PR #6 (`7d876d4`) and had been on `main` for multiple commits before anyone noticed. **Nothing was checking.** CLAUDE.md described a CI pipeline, but `.github/workflows/` did not exist. The doc was load-bearing fiction.

The fix had two parts:
1. Exclude test files from the server tsc build (commit `ec0e422`).
2. Wire up the CI pipeline so the next regression is caught at PR time, not at deploy time. ← this page.

## What runs (4 of 5 steps from CLAUDE.md)

| Step | Command | What it catches |
|---|---|---|
| 1. Install | `pnpm install --frozen-lockfile` | Lockfile drift, missing deps, registry outages |
| 2. ~~Lint~~ | _deferred — see "Known gap: lint" below_ | — |
| 3. Typecheck | `pnpm tsc:check` (turbo → `tsc --noEmit` per package; client uses `tsc -b --noEmit`) | All TypeScript errors. Faster than full build because no emit |
| 4. Test | `pnpm test` (turbo → `vitest run` per package) | Unit/integration test regressions |
| 5. Build | `pnpm build` (turbo → `tsc` server/shared, `tsc -b && vite build` client) | Anything typecheck missed (rare, but project references / emit-only quirks live here) |

Step 3 is partially redundant with step 5 in this monorepo because every package's `build` runs `tsc`. It's kept anyway because:
- It runs faster (no emit, no Vite bundling) and surfaces type errors before the heavier build step kicks in.
- It's the explicit faithful implementation of what CLAUDE.md promises.
- Devs can call `pnpm tsc:check` locally for a 6-second sanity check before pushing.

## Implementation notes
- **Triggers** — `push` to `main` and `pull_request` targeting `main`.
- **Concurrency** — in-progress runs for the same ref are cancelled when a new commit lands (saves CI minutes on rapid pushes).
- **Runner** — `ubuntu-latest`. No Windows or macOS matrix because the production target is Render Linux.
- **Node version** — 22 (LTS). Matches `engines.node: ">=20"` from root package.json with a stable LTS baseline.
- **pnpm version** — `10.31.0`, pinned to match the `packageManager` field in root package.json. Mismatched pnpm versions can produce different lockfiles → install drift.
- **Cache** — `actions/setup-node` caches `pnpm store` keyed by `pnpm-lock.yaml`. First run is slow; subsequent runs reuse the cache.
- **Timeout** — 15 min hard cap. Current cold-cache run is ~3-4 min; warm-cache ~1-2 min. The cap exists to fail loudly on an infinite hang rather than burn minutes.

## Trade-offs considered

**Single job vs split jobs.** Could split into parallel `lint` / `typecheck` / `test` / `build` jobs to fail faster. Kept as a single sequential job because:
- The pnpm install and turbo cache warm-up dominate the cold-cache run; splitting jobs duplicates that overhead.
- For a small monorepo, sequential failures at step N are clearer than four parallel red Xs.
- Easy to split later when the test suite grows past ~30 seconds.

**Coverage / artifact upload.** Not yet wired. Add when there's a concrete consumer (e.g., a coverage badge, or a code-coverage gate).

**E2E (Playwright) tests.** `pnpm --filter @culinaire/client test:e2e` exists but isn't in CI yet. E2E needs a running server + DB; that's a separate workflow with services, deferred until we want to invest in flakiness-management for it.

**Branch protection rules.** This workflow is the *technical* side. The *policy* side is configuring `main` branch protection on GitHub to require this check before merge. Set that up in repo Settings → Branches → Add rule → "Require status checks to pass before merging" → select `Lint, typecheck, test, build`.

## Failure-mode mapping
What each step would catch in a regression:

| Failure mode | Caught by | Step |
|---|---|---|
| New dep added but lockfile not committed | `pnpm install --frozen-lockfile` exits non-zero | 1 |
| `import { foo } from 'bar'` where `foo` is missing | typecheck | 3 |
| Type error anywhere in `src/` | typecheck | 3 |
| Type error in a `.test.ts` (the original incident) | test step (vitest does its own typecheck), and build if not excluded | 4 |
| Logic regression in a covered code path | unit test failure | 4 |
| Project-references graph broken (client `tsc -b`) | build | 5 |
| Vite-specific config error | build | 5 |

## Known gap: lint
CLAUDE.md lists `Lint (eslint)` as step 2 of the pipeline. **eslint is not installed anywhere in this repo** — no devDependency in any of the 3 packages, no `eslint.config.*` or `.eslintrc.*`, no rules. The per-package `"lint": "eslint src/"` scripts are broken stubs that error with "eslint is not recognized" when invoked.

The CI workflow ships **without** the lint step, intentionally — running broken scripts in CI just guarantees a permanently-red pipeline.

To close the gap (separate piece of work, tracked in `tasks/todo.md`):
1. Add `eslint` + relevant plugins (`@typescript-eslint/eslint-plugin`, `eslint-plugin-react`, `eslint-plugin-react-hooks` for client) as root devDependencies.
2. Write a flat-config `eslint.config.js` at root, with package-specific overrides for client (React) vs server (Node) vs shared.
3. Pick rules. Suggest starting with `@typescript-eslint/recommended` + project taste.
4. Re-add the `Lint` step to `.github/workflows/ci.yml`.
5. Update this page.

Out of scope for this CI work because rule selection is a taste decision worth its own discussion, and turning on lint with auto-discovered rules is likely to surface dozens of pre-existing issues that need triage.

## Cleanup follow-up
CLAUDE.md also describes Husky + lint-staged pre-commit hooks. Those don't exist either. Adding them is a separate decision — useful but redundant once branch protection is enabled. Not gated on this CI work.

## Related
- [[technical-architecture]] — pnpm + Turborepo + per-package build commands
- [[culinaire-kitchen-platform]]
