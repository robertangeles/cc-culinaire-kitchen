---
title: CulinAIre Kitchen Platform
category: entity
created: 2026-04-29
updated: 2026-04-29
related: [[store-locations-system]], [[prompt-system]], [[technical-architecture]], [[data-flow-architecture]]
---

The product as a whole — an AI-grounded operating system for working culinary professionals, spanning chat, creative R&D, kitchen ops, and community.

## Source of truth
Live document: [docs/architecture/overview.md](../../docs/architecture/overview.md)

## What it is
CulinAIre Kitchen is a multi-module operating system for working culinary professionals — line cooks, restaurateurs, patissiers. It is **not** a recipe site and **not** a spreadsheet replacement. It is an AI-grounded workbench that sits next to the actual cooking and the actual running of a kitchen.

## The four lobes
- **Chat Assistant** — culinary knowledge chatbot grounded in curated content (techniques, pastry, spirits, ingredients). The founding module.
- **Creative Labs** — Recipe Lab, Patisserie Lab, Spirits Lab. R&D space for new dishes, pastries, cocktails.
- **Kitchen Operations** — Recipe Book, Stock Room, Purchasing, Menu Intelligence, Kitchen Copilot, Waste Intelligence.
- **Community** — shared CulinAIre Recipe Book + The Bench (real-time chat for operators).

## Headline flow
1. User signs up, verifies email, lands on chat.
2. Chat question → Express server → AI provider (via OpenRouter) with culinary system prompt.
3. AI grounds answer in the curated knowledge base (markdown + pgvector).
4. Streamed response → conversation persisted to PostgreSQL.

## Audience constraints
Operators, not engineers. Plain English copy. No jarring loading flashes. Mobile-first because the back dock and the walk-in are where the work happens.

## Related entities
- [[store-locations-system]] — multi-location architecture under each Organisation
- [[prompt-system]] — prompt registry, runtime guard, versioning
- [[technical-architecture]] — tech stack and monorepo layout
- [[data-flow-architecture]] — system + request flow diagrams
