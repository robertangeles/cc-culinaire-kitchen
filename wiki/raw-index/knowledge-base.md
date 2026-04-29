---
title: Knowledge Base (raw culinary content)
category: raw-index
created: 2026-04-29
updated: 2026-04-29
related: [[culinaire-kitchen-platform]], [[prompt-system]]
---

Pointer page. The curated culinary content under [knowledge-base/](../../knowledge-base/) is **immutable source content** — treat it as `raw/` even though it lives at its own top-level path. Do not move it: server startup syncs it into pgvector via SHA-256 hash check, and code reads from this path directly.

## Why it doesn't live under `raw/`
The runtime knowledge sync resolves files by `knowledge-base/<category>/<file>.md`. Relocating would invalidate every embedding and break grounding for the chatbot.

## Folder structure
```
knowledge-base/
├── techniques/
│   ├── searing.md
│   ├── emulsions.md
│   ├── braising.md
│   └── knife-skills.md
├── pastry/
│   ├── custards.md
│   ├── doughs.md
│   └── chocolate.md
├── spirits/
│   └── cocktail-structures.md
└── ingredients/
    ├── herbs.md
    └── fats.md
```

Each file uses a YAML frontmatter block: `title`, `category`, `tags`.

## How the SHA-256 sync works (high level)
1. On server startup, the knowledge service walks `knowledge-base/`.
2. For each file, it computes a SHA-256 of the body.
3. It compares against `knowledge_document.content_hash` in PostgreSQL.
4. If the hash differs (or the row is missing), it re-embeds the document and upserts the row + the pgvector embedding.
5. Unchanged files are skipped — no API cost on a clean restart.

## Editing rules
- New file → add it under the right subfolder, restart the server (or trigger sync), confirm the row appears in `knowledge_document`.
- Edit an existing file → save, restart/sync. The old embedding is replaced atomically.
- Renaming or moving a file is destructive — the old row may be orphaned. Add the new file, confirm sync, then delete the old row deliberately.

## Files (live links)
- [knowledge-base/techniques/searing.md](../../knowledge-base/techniques/searing.md) — Pan searing & Maillard
- [knowledge-base/techniques/emulsions.md](../../knowledge-base/techniques/emulsions.md) — Emulsion science, hollandaise, vinaigrettes
- [knowledge-base/techniques/braising.md](../../knowledge-base/techniques/braising.md) — Collagen conversion & liquid ratios
- [knowledge-base/techniques/knife-skills.md](../../knowledge-base/techniques/knife-skills.md) — Classical cuts & dimensions
- [knowledge-base/pastry/custards.md](../../knowledge-base/pastry/custards.md) — Stirred & baked custards
- [knowledge-base/pastry/doughs.md](../../knowledge-base/pastry/doughs.md) — Brisée, sucrée, choux, puff
- [knowledge-base/pastry/chocolate.md](../../knowledge-base/pastry/chocolate.md) — Tempering & ganache
- [knowledge-base/spirits/cocktail-structures.md](../../knowledge-base/spirits/cocktail-structures.md) — Sour / Old-fashioned / Highball / Martini
- [knowledge-base/ingredients/herbs.md](../../knowledge-base/ingredients/herbs.md) — Volatile vs hardy herbs
- [knowledge-base/ingredients/fats.md](../../knowledge-base/ingredients/fats.md) — Smoke points & application matrix

## Related
- [[culinaire-kitchen-platform]]
- [[prompt-system]]
