---
title: Lessons Index
category: synthesis
created: 2026-04-29
updated: 2026-04-29
related: [[project-status]]
---

Index of the Problem / Fix / Rule entries in [tasks/lessons.md](../../tasks/lessons.md). The lessons file is the source of truth — this page is a discoverable surface so the wiki can point at the right rule fast.

## How to use
- Read [tasks/lessons.md](../../tasks/lessons.md) at session start (per CLAUDE.md §3 self-improvement loop).
- When you hit one of these classes of problem, jump straight to the linked rule.
- Append new lessons to `tasks/lessons.md` first, then add a one-line entry here if it warrants discovery from the wiki.

## Rules indexed (top of file)

| # | Rule | Topic |
|---|---|---|
| 1 | Never use Google Drive for Node.js projects | filesystem / pnpm symlinks |
| 2 | Monorepo dotenv path requires explicit config | env loading |
| 3 | DB module must use lazy initialisation in monorepos | env loading / module init |
| 4 | Database naming conventions (singular tables, `_ind` / `_dttm` suffixes, integer FKs, table-prefixed columns) | schema |
| 5 | Services that depend on optional API keys must use lazy init | server startup resilience |
| 6 | Keep imports consistent across route files | ESM module resolution |
| 7 | otplib v4+ API migration (top-level exports, not `authenticator`) | dependency upgrade |
| 8 | Role/permission renames require migration + seed + route updates | RBAC change protocol |
| … | _45+ entries — read the full list in [tasks/lessons.md](../../tasks/lessons.md)_ | — |

## Why this is a synthesis page, not an entity
Lessons are cross-cutting — they don't belong to any single named subsystem. They are the project's accumulated tacit knowledge.

## Related
- [[project-status]]
