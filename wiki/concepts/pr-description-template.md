---
title: PR description template (ways of working)
category: concept
created: 2026-04-30
updated: 2026-04-30
related: [[claude-md]], [[dev-server-plus-playwright-verification]]
---

Every pull request opened against this repo includes a structured description body. The default GitHub-generated body or a one-liner is not acceptable. Reviewers should be able to understand the PR without reading every commit.

## Why this exists

Commit messages cover individual changes. The PR description covers the PR as a whole — *why* it exists, what's in it, what was deliberately left out, how it was verified, the rollback story. Without that, every review starts from zero and surfacing scope-creep questions ("did you also touch X?") becomes the reviewer's job.

The norm was established after PR #9 (catalog-spine Phase 1) on 2026-04-30.

## Required sections

Every PR body must cover at minimum:

1. **Summary** — one sentence. What this PR is.
2. **Why this exists** — the problem it solves, the user-reported issue it fixes, or the goal it advances.
3. **What ships** — grouped by surface (schema / backend / frontend / shared / tests / migration). Bullet points, not prose. Each bullet names the concrete artefact (file, function, route).
4. **Out of scope** — work that was considered and explicitly deferred, with one-line rationale each. Cuts scope-creep questions in review.
5. **Test plan** — typecheck, unit tests, integration tests, migration verification, Playwright UI verification (when applicable). Use checkbox format `- [x]` so the reviewer can scan what was done.
6. **Risk** — Low / Medium / High plus a sentence on the rollback path.
7. **Depends on** — predecessor PRs, migrations, or feature flags the reviewer needs to know about.

End with the standard `🤖 Generated with [Claude Code]` footer.

## How Claude writes it

When opening a PR via `gh pr create` or updating one via `gh pr edit`, write the body to `C:/tmp/pr<N>-body.md` first and pass it via `--body-file`. Multiline markdown survives the CLI cleanly that way — `--body "..."` truncates or escapes badly on long bodies.

Example:

```bash
# write the body file (Write tool, not echo, to keep it clean)
Write C:/tmp/pr9-body.md   # full markdown, all 7 sections

# update an existing PR
gh pr edit 9 --body-file "C:/tmp/pr9-body.md"

# create a new PR
gh pr create --title "Catalog Spine — Phase 1" --body-file "C:/tmp/pr10-body.md"
```

## What Claude does NOT do

- Leave the body as the default `Created via gh` text.
- Compress everything into one paragraph.
- Skip "Out of scope" — that's the section that prevents scope-creep questions.
- Skip "Test plan" — without it the reviewer has to assume nothing was verified.
- Use `--body "..."` for anything longer than a couple of lines — escaping breaks markdown.

## Reference example

PR #9 (catalog-spine Phase 1) follows this template exactly. Read its description as the canonical example.
