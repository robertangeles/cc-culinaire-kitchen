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

## Decisions
| Page | Summary | Created |
|---|---|---|
| [OpenRouter Migration](decisions/openrouter-migration.md) | Replaced direct AI provider keys with one OpenRouter gateway for chat/embeddings/web-search/image-gen | 2026-04-29 |
| [Duplicate recipeRefinementPrompt.md — pending cleanup](decisions/duplicate-recipe-refinement-prompt.md) | Two byte-identical copies; canonical = `prompts/chatbot/`, the `prompts/recipe/` copy is dead | 2026-04-29 |
| [CI Pipeline (GitHub Actions)](decisions/ci-pipeline.md) | Wire up the install→lint→typecheck→test→build pipeline CLAUDE.md described but had never existed on disk; triggered by 2026-04-29 Render deploy failure | 2026-04-29 |

## Synthesis
| Page | Summary | Created |
|---|---|---|
| [Project Status](synthesis/project-status.md) | Phase-by-phase summary of shipped work, derived from `tasks/todo.md` | 2026-04-29 |
| [Lessons Index](synthesis/lessons-index.md) | Discoverable index of the Problem/Fix/Rule entries in `tasks/lessons.md` | 2026-04-29 |

## Raw-index (pointers to immutable source content)
| Page | Summary | Created |
|---|---|---|
| [Knowledge Base (raw culinary content)](raw-index/knowledge-base.md) | Pointer to `knowledge-base/` — the curated culinary corpus synced into pgvector | 2026-04-29 |
| [Landing Page Creative Brief](raw-index/landing-page-creative-brief.md) | Pointer to the April 2026 creative brief (immutable artefact) | 2026-04-29 |

## Session log
[wiki/log.md](log.md) — append-only history of wiki changes per session.
