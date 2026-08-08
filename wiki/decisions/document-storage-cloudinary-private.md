---
title: Compliance Documents Store to Cloudinary Private, Never Local Disk
category: decision
created: 2026-08-07
updated: 2026-08-07
related: [[staff-compliance-vault]], [[compliance-expiry-engine]]
---

Compliance documents (police checks, Medicare cards, RSA certificates) go through a dedicated `documentStorageService.ts` that has no local-disk branch at all, mints 120-second Cloudinary-signed URLs instead of the vendor's 1-hour default, and accepts Cloudinary — not this codebase — as the holder of the encryption key.

## The hazard this exists to avoid

`middleware/upload.ts` already has a working, reusable-looking upload helper: `uploadFileBuffer`. It is not safe for this feature. When Cloudinary credentials are absent or fail to load, it silently falls back to writing the file to local disk under `/uploads/<name>`, and `index.ts` serves that directory with `express.static` and **no authentication at all**. For a restaurant logo that's a non-issue. For a police check or a Medicare card, it is a notifiable data breach that happens one missing environment variable away, with no error raised and nothing in the logs to say it happened.

`documentStorageService.ts` (`packages/server/src/services/documentStorageService.ts`) was written with that specific failure mode as its design constraint, stated at the top of the module in a comment that exists so nobody copy-pastes `uploadFileBuffer` in later. The rule: **this service must never call `uploadFileBuffer`**, and it contains no local-disk branch anywhere. Missing or broken Cloudinary credentials are a hard failure — `requireCloudinary()` throws, nothing is written anywhere, and the caller gets `503 STORAGE_UNCONFIGURED` ("Can't accept uploads right now"). `routes/compliance.ts` also builds its own `multer.memoryStorage()` upload directly rather than routing through `middleware/upload.ts`, for the same reason.

## Delivery model

```
upload  ->  magic-byte sniff (never trust the client's declared MIME)
        ->  cloudinary type:"private", org-scoped folder
        ->  store the public_id ONLY, never a URL

view    ->  caller has already passed requirePermission + an ownership check
        ->  private_download_url with a 120-second expiry
        ->  document_access_log row written for EVERY attempt, granted or denied
```

`sniffMime()` reads magic bytes (`%PDF`, `FFD8FF` JPEG, the 8-byte PNG signature) and ignores the client's declared `Content-Type` entirely, because that header is attacker-controlled. A PDF renamed to `.jpg` and a polyglot file both fail here. Notably, `image/svg+xml` — allowed by `middleware/upload.ts` for images — is deliberately absent from this service's `AllowedMime` type: an SVG is an XML document that can carry script, and these files get served back to managers.

Only the Cloudinary `public_id` is persisted in `compliance_document.storage_public_id`, never a URL. URLs are minted per view and expire; storing one would be storing a credential with a shelf life.

## Signed-URL TTL: 120 seconds, not Cloudinary's 1-hour default

`SIGNED_URL_TTL_SECONDS = 120` is set explicitly against Cloudinary's default `expires_at` window of one hour, which is far longer than opening a document actually needs and would leave a leaked link live well past the session that produced it.

The `type: "private"` delivery mode this depends on has a real operational consequence: a private asset is **not** served from Cloudinary's CDN. Every single view — even the same document viewed twice — is an authenticated, metered API call to Cloudinary (`private_download_url`), slower than a CDN fetch and billed per call. That is the correct trade for this content, but it means callers must **issue signed URLs on click, and never prefetch them for a list.** A dashboard rendering thirty documents must not mint thirty signed URLs up front just because it can — that is thirty billed API calls for documents nobody may ever open.

## Encryption at rest: Cloudinary's key, not ours

This is a recorded, accepted deviation from a literal reading of the original spec's "AES-256 at rest" requirement, decided when Cloudinary private storage was chosen over building new infrastructure (it was already installed and credential-managed). Cloudinary encrypts stored objects with **its own** key, not a key this codebase generates, holds, or rotates. If a customer's procurement team ever asks "who can decrypt these documents," the honest, complete answer is **"Cloudinary and us"** — not "only us." Migrating to customer-managed encryption keys later would mean re-encrypting and re-uploading every stored file, not a config flip.

## Access is logged — including denials

`signedUrlForDocument()` writes a `document_access_log` row on **every** call, before it does anything else, whether the caller passed `granted: true` or `granted: false`. A denied attempt still gets logged (`outcome: "denied"`) and the function returns `null` without ever calling Cloudinary. The function does not itself decide whether access is allowed — the caller must have already run `requirePermission` plus an ownership check (see [[staff-compliance-vault]] on why `compliance:read-own` alone isn't enough) and passes the verdict in.

The denied rows are the ones that matter most when reconstructing an incident: `listDeniedAccessByActor()` answers "is someone probing?" directly from the log, something a granted-only audit trail could never answer. Losing that signal — logging grants but not denials, which is the more common instinct — would have made this table half as useful for the one job it exists to do.

## Consequences

- Any code that needs to store or serve a file for this feature must go through `documentStorageService.ts` specifically — not the general-purpose upload helper, no matter how similar the need looks.
- Every document view costs a real Cloudinary API call. List views (dashboard, staff document lists) render metadata only and defer the signed-URL mint until the user actually clicks to open one.
- `document_access_log` grows on every view, granted or denied, and needs its own retention/prune schedule — it is not free to keep forever.

## Related
[[staff-compliance-vault]] · [[compliance-expiry-engine]]
