# Changelog

All notable changes to CulinAIre Kitchen are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] — 2026-10-01

### Fixed

- **Recipe refinements now use knowledge base context.** `recipeRefinementService` was reading `.text`/`.content` from search results — fields that don't exist on `SearchResult`. The field is `.snippet`. RAG context was silently empty on every recipe refinement call; it now contains the relevant knowledge base snippets.
- **Subscription period end dates populate across all Stripe API versions.** Stripe SDK v20 moved `current_period_end` to `SubscriptionItem`; accounts on older API versions still return it at the subscription level. Both locations are now checked so subscription display is correct regardless of account API version.
- **E2E test selectors repaired** after guide panel and networkidle changes introduced stale selectors in `purchasing.spec.ts` and `order-guides.spec.ts`.

### Changed

- **TypeScript `no-explicit-any` enforced** on all production server code. 238 explicit `any` usages replaced with concrete types, `catch (err: unknown)` guards, or minimal type assertions. ESLint `@typescript-eslint/no-explicit-any: error` added to production config (test files remain exempt).
- **Catch handlers now return `String(err)`** for non-Error thrown values instead of `undefined`. All 36 server catch blocks use `err instanceof Error ? err.message : String(err)` pattern.
