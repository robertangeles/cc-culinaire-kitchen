---
title: Wiki Index
description: Master catalog of every wiki page in this project
---

# CulinAIre Kitchen — Wiki Index

The living knowledge base for this project. Read this first at the start of every session.

## Inspiration
Patterned after Andrej Karpathy's LLM-wiki gist: <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>. The categories (entities / concepts / decisions / synthesis), the master `index.md`, and the append-only `log.md` come from that template.

## Tooling
The wiki ships with two helper scripts. Use them before reading full pages.

| Level | Tool | Purpose |
|---|---|---|
| 2 | `node scripts/wiki-search.mjs <query>` | fast local text search across all wiki pages |
| 2 | `node scripts/wiki-search.mjs -c <query>` | same, with 2-line context per match |
| 4 | `node scripts/wiki-graph.mjs build` | rebuild `wiki/.graph.json` from frontmatter + `[[refs]]` |
| 4 | `node scripts/wiki-graph.mjs stats` | node/edge counts + category breakdown |
| 4 | `node scripts/wiki-graph.mjs neighbors <slug>` | in/out edges for a page |
| 4 | `node scripts/wiki-graph.mjs orphans` | pages with no edges |
| 4 | `node scripts/wiki-graph.mjs broken` | `[[slug]]` refs pointing to missing pages |
| 4 | `node scripts/wiki-graph.mjs category <name>` | list pages in a category |

Both are pure Node, zero new deps. `wiki/.graph.json` is gitignored — regenerate with `build` after editing any `related:` line or `[[slug]]` reference.

Categories: **entity** (named things) · **concept** (patterns) · **decision** (choices with rationale) · **synthesis** (cross-cutting analysis) · **raw-index** (pointers to immutable source content)

## Project rules (the most important document)
| Page | Summary | Created |
|---|---|---|
| [CLAUDE.md](../CLAUDE.md) | Behavioral guidelines, architecture rules, DB conventions, git workflow, testing, security — the project's constitution | 2026-04-29 (linked) |

## Entities
| Page | Summary | Created |
|---|---|---|
| [CulinAIre Kitchen Platform](entities/culinaire-kitchen-platform.md) | The product as a whole — chat, creative labs, kitchen ops, community | 2026-04-29 |
| [Store Locations System](entities/store-locations-system.md) | Multi-location subsystem under each Organisation (HQ, Branch, Commissary, Satellite) | 2026-04-29 |
| [Prompt System](entities/prompt-system.md) | Prompt registry, runtime guard, versioning, mobile fetch endpoint | 2026-04-29 |

## Concepts
| Page | Summary | Created |
|---|---|---|
| [Technical Architecture](concepts/technical-architecture.md) | Tech stack, monorepo layout, server startup order | 2026-04-29 |
| [Data Flow Architecture](concepts/data-flow-architecture.md) | System + request flow diagrams, startup sequence | 2026-04-29 |
| [Mobile API Contract](concepts/mobile-api-contract.md) | Cross-repo contract with the separate mobile repo: auth transport, `/api/mobile/*`, device tokens, push readiness | 2026-04-29 |
| [Dev server + Playwright verification](concepts/dev-server-plus-playwright-verification.md) | UI ways of working: every UI change gets rendered + screenshotted via Playwright before being reported done | 2026-04-29 |
| [PR description template](concepts/pr-description-template.md) | Every PR includes a structured description (summary / why / what / out-of-scope / test plan / risk / depends-on) | 2026-04-30 |
| [Surface Partition](concepts/surface-partition.md) | The `(slug, surface)` / `runtime` pattern that lets web and mobile own distinct rows for the same logical content | 2026-05-03 |
| [Formula Catalog](concepts/formula-catalog.md) | Complete catalog of every formula in the cost, stock, prep, and forecasting engine with forward/backward proofs | 2026-06-01 |
| [Reconciliation Matrix](concepts/reconciliation-matrix.md) | Cross-reference of stock-affecting and cost-affecting operations, balance rules, and cross-operation invariants | 2026-06-01 |
| [Cloudflare Turnstile Bot Protection](concepts/turnstile-bot-protection.md) | Hard-enforced Turnstile on login/register/forgot-password; DB-managed keys via Settings → Integrations → Cloudflare; fail-closed verification | 2026-06-30 |

## Decisions
| Page | Summary | Created |
|---|---|---|
| [OpenRouter Migration](decisions/openrouter-migration.md) | Replaced direct AI provider keys with one OpenRouter gateway for chat/embeddings/web-search/image-gen | 2026-04-29 |
| [Duplicate recipeRefinementPrompt.md — RESOLVED](decisions/duplicate-recipe-refinement-prompt.md) | Resolved 2026-05-03; the dead `prompts/recipe/` copy was deleted, the canonical `prompts/chatbot/` copy stays as runtime fallback | 2026-05-03 |
| [Auto-inject shared-context on every prompt](decisions/shared-context-auto-injection.md) | UserPromptSubmit hook in `.claude/settings.local.json` injects head of `mobile-needs.md` + `decisions.md` so the web session is always aware of mobile updates | 2026-05-03 |
| [CI Pipeline (GitHub Actions)](decisions/ci-pipeline.md) | Wire up the install→lint→typecheck→test→build pipeline CLAUDE.md described but had never existed on disk; triggered by 2026-04-29 Render deploy failure | 2026-04-29 |
| [Dev/prod database separation](decisions/dev-prod-db-separation.md) | Local dev runs on a local Postgres; boot guard blocks dev→remote DB. drizzle-kit versioned migrations rejected due to known schema drift | 2026-06-16 |
| [Single .env file with DEV_/PROD_ prefixes](decisions/single-env-file.md) | One root `.env` for everything; `APP_ENV` switch + bootstrap shim copies prefixed values into unprefixed slots at startup | 2026-06-17 |
| [Remove on-device prompt runtime](decisions/remove-device-runtime-prompts.md) | Mobile pivoted to server-side chat (2026-06-15); `prompt.runtime`, `/api/mobile/prompts/:slug`, on-device admin UI, and Antoine prompts removed | 2026-06-17 |

## Synthesis
| Page | Summary | Created |
|---|---|---|
| [Feature Catalog](synthesis/features.md) | Living catalog of every user-facing feature, grouped by product lobe + platform layer; update as features ship or change | 2026-06-29 |
| [Project Status](synthesis/project-status.md) | Phase-by-phase summary of shipped work, derived from `tasks/todo.md` | 2026-04-29 |
| [Lessons Index](synthesis/lessons-index.md) | Discoverable index of the Problem/Fix/Rule entries in `tasks/lessons.md` | 2026-04-29 |
| [Schema drift (May 2026)](synthesis/schema-drift-may-2026.md) | Known drift between Drizzle code and live DB; safe migration workflow until drift is zero | 2026-05-26 |

## Raw-index (pointers to immutable source content)
| Page | Summary | Created |
|---|---|---|
| [Knowledge Base (deprecated folder)](raw-index/knowledge-base.md) | Records the 2026-05-03 removal of `knowledge-base/`; explains where knowledge content actually lives (DB + admin UI) | 2026-05-03 |
| [Landing Page Creative Brief](raw-index/landing-page-creative-brief.md) | Pointer to the April 2026 creative brief (immutable artefact) | 2026-04-29 |

## Session log
[wiki/log.md](log.md) — append-only history of wiki changes per session.
