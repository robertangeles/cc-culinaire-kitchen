---
title: Knowledge Base (deprecated folder)
category: raw-index
created: 2026-04-29
updated: 2026-05-03
related: [[culinaire-kitchen-platform]], [[prompt-system]]
---

The top-level `knowledge-base/` folder was removed on 2026-05-03. The earlier version of this page described a SHA-256 boot-time sync that never actually existed in code — the folder was a frozen seed corpus from the project's earliest weeks and had no runtime consumer.

## Where knowledge content actually lives

Curated culinary knowledge is stored in Postgres:

- `knowledge_document` — one row per document (title, source, metadata).
- `knowledge_document_chunk` — chunked text + pgvector embeddings.

It is authored and managed exclusively through the admin UI at **Settings → Knowledge Base** ([KnowledgeBaseTab.tsx](../../packages/client/src/components/settings/KnowledgeBaseTab.tsx)). Uploads, manual entries, and URL ingest all flow through [knowledgeManagementService.ts](../../packages/server/src/services/knowledgeManagementService.ts).

## Where the chatbot reads from

[knowledgeService.ts](../../packages/server/src/services/knowledgeService.ts) exposes:

- `searchKnowledge` — vector search for the chatbot's tool-use loop.
- `retrieveForMobile` — richer-shape sibling for the mobile RAG endpoint at `POST /api/mobile/rag/retrieve`.

Both query the Postgres tables above. Neither touches the filesystem.

## Recovery

The original ten markdown files (techniques / pastry / spirits / ingredients) are preserved in git history. To recover them:

```sh
git show 9d770f1:knowledge-base/techniques/searing.md
# or for the whole folder, find the commit that removed it and check out the parent:
git log --diff-filter=D --summary -- knowledge-base/
```

## Related
- [[culinaire-kitchen-platform]]
- [[prompt-system]]
