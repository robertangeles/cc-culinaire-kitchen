---
title: Dev server + Playwright verification (UI ways of working)
category: concept
created: 2026-04-29
updated: 2026-04-29
related: [[claude-md]]
---

For every UI change in this project, Claude must run the dev server and use Playwright to view the actual rendered page before reporting the change as done. Verification is a step, not a courtesy.

## Why this exists

The user cannot always provide screenshots or type long error messages back. Round-tripping on UI bugs that Claude could have caught by *looking at the page* wastes their time. Playwright is in the toolbox for exactly this. Skipping the look-see is a process failure, not a time-saver.

## Workflow

For any change under `packages/client/src/**`, any new component, any styling change, or any visual spec landing from a design review:

1. Make the code change.
2. Start (or verify) the dev server.
   - Frontend: Vite on port **5179**.
   - Backend: Express on port **3009**.
   - Never default to 3000 / 5173 (per CLAUDE.md "Local Development Ports").
3. Use the `webapp-testing` skill (Playwright) to navigate to the affected page.
4. Take a screenshot. Inspect the rendering.
5. Check the browser console + network tab for errors.
6. Iterate until the page actually looks and behaves right.
7. Report done with a one-liner: "Verified rendering at /menu/items via Playwright; screenshot attached."

## Backend-only changes

Pure backend changes (services, routes, schema migrations, prompts) do NOT require Playwright. They DO require curl-based route verification per the **Regression Testing Protocol** in CLAUDE.md (every new/updated API route hit with happy + 401 + 400 paths before wiring the frontend).

## What this is not

- Not a static HTML preview. The goal is the LIVE app, with real auth, real data, real backend.
- Not a substitute for unit + integration tests. Playwright catches *visual* and *interaction* defects that automated assertions miss; it doesn't replace `pnpm test`.
- Not "I'll do it once at the end." Every iteration that touches UI gets a fresh look.

## Tools

- `webapp-testing` skill — toolkit for navigating, asserting, and screenshotting local web apps via Playwright.
- `browse` (gstack) — also fine for quick visual checks; use whichever is in hand.
- Direct Playwright is acceptable but the skills are pre-wired with the right defaults.

## When this norm landed

User established this as a working norm on 2026-04-29 during the Phase 0 kickoff for the catalog-spine initiative. Quote: "I cannot always give you screenshots or type long errors. So, can we do that? Dev + Playwright."
