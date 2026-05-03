---
title: Surface Partition
category: concept
created: 2026-05-03
updated: 2026-05-03
related: [[culinaire-kitchen-platform]], [[mobile-api-contract]], [[prompt-system]]
---

How web and mobile own distinct copies of the same logical content (Terms, Privacy, prompts, future flags) without cross-contamination — the `surface` column + `(slug, surface)` composite unique pattern, introduced 2026-05-03 in commit `8c97b0c`.

## The problem

Web and mobile present overlapping concepts under the same name — both have a "Privacy Policy", both consume an "Antoine system prompt", both will eventually have onboarding copy, push-notification templates, and so on. But the wording, the audience, and the runtime can all diverge:

- Web `/privacy` is read by logged-out browser visitors via the landing footer; mobile `privacy` is read by authenticated app users inside a native screen.
- The Antoine EN system prompt is server-runtime when consumed by the web chatbot tool-use loop, but device-runtime when fetched by the mobile app for on-device Gemma 3n E4B inference.
- Each side has its own publish state, edit cadence, and reviewer.

A single shared row would force one of the surfaces to compromise. Two separate tables would duplicate every CRUD path. The compromise is one table with a `surface` column and composite uniqueness.

## The pattern

Each affected table gains:

```sql
surface  varchar(20)  NOT NULL  DEFAULT 'web'
UNIQUE (slug, surface)         -- or (key, surface), (name, surface), etc.
```

Where the table previously had a unique on the natural key alone, the constraint becomes composite with `surface`. A reserved-slug seeder (e.g. `terms`, `privacy`) iterates `SURFACES = ['web', 'mobile']` and seeds one row per (slug, surface) combination at boot. Each row carries its own body, publish state, timestamps.

The `surface` value is fixed at creation and never changes — it's part of the row's identity, not a mutable attribute.

## Where it's used today

| Domain | Table | Distinguished by |
|---|---|---|
| Static legal copy | `site_page` | `(slug, surface)` |
| LLM prompts | `prompt` | `runtime` column (`'server' | 'device'`) — semantically the same partition; predates the explicit `surface` naming |

The `prompt` table technically pre-dates the `surface` naming convention: it uses `runtime` (`server`/`device`) which is the mobile-vs-web partition expressed in runtime terms rather than surface terms. New tables should use the `surface` name and the same composite-unique pattern.

## End-to-end plumbing checklist

When a new partitioned table is added, these layers all need the surface:

1. **Schema** — `surface` column with default; composite unique.
2. **Service** — every read/write function takes `surface` as a parameter; reserved-slug seeder iterates surfaces.
3. **Controller** — accepts `?surface=web|mobile` (public routes default to `web` for backward compat with the web client); admin routes require it explicitly so the UI never confuses which surface it's editing.
4. **Routes** — no path changes. The query param is the switch.
5. **Public web client** — hooks default `surface='web'`. Existing routes (e.g. `/terms`, `/privacy`) keep working unchanged.
6. **Admin client** — surface flows in from the tab the admin is on (`<PagesTab surface="web" />` vs `<PagesTab surface="mobile" />`). The tab registry's `group` field (Web / Mobile / Shared / Unassigned) makes scope visible at the sidebar level.
7. **Mobile client** — passes `surface=mobile` in every fetch URL.
8. **api-contracts.md (shared-context)** — the contract documents the query param as part of the endpoint shape so the mobile session can wire correctly.

## Trade-offs that drove the design

- **Web public routes default `?surface=web`** — preserves backward compatibility with the existing footer wiring (`/terms`, `/privacy`). New surfaces opt in via the explicit param.
- **Admin routes require `?surface=...`** — prevents an admin from editing the wrong surface accidentally. The web admin couldn't accidentally write into a mobile row even if it tried; the surface filter scopes every query.
- **One column, not separate tables** — a single CRUD path serves both surfaces. New surfaces (e.g. an iPad line-cook mode, a kiosk mode) become one new value of the column, not a new table.
- **Reserved slugs seeded per-surface at boot** — `terms` and `privacy` always exist as draft rows on every surface, so admins always have a starting point and `getPublishedPageBySlug` never has to handle "table is empty".

## Pitfalls observed

- **Admin UI surface ambiguity.** When the admin Pages list shows the same slug on both surfaces (`Privacy Policy /privacy` under Web, `Privacy Policy /privacy` under Mobile), the visual cue that distinguishes them is the sidebar group (Web vs Mobile) — but a sighted admin may not register that. Adding a surface badge in the row chip is cheap insurance against publishing the wrong surface.
- **Slug rename is a destructive operation, not an edit.** The slug+surface pair is the natural key; changing the slug breaks every consumer. The Pages admin makes the slug field read-only post-create for exactly this reason.
- **Reserved slug deletion guards span all surfaces.** `RESERVED_SLUGS = {terms, privacy}` matches by slug only — the delete guard refuses to remove a reserved slug regardless of surface. This is intentional: every surface needs its terms and privacy rows to exist.

## Related

- [[culinaire-kitchen-platform]]
- [[mobile-api-contract]] — site-pages endpoint and the `?surface=` parameter
- [[prompt-system]] — the prompt table's `runtime` column is the same pattern under an older name
