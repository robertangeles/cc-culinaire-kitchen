# Git hooks

Committed hooks, shared across machines via `core.hooksPath`.

## One-time setup (run once per machine, per clone)

```bash
git config core.hooksPath hooks
```

That's it. The hooks are already executable and committed.

## What's here

### `prepare-commit-msg` — dev-machine provenance

Appends a `Dev-Environment:` trailer to every real commit, read from
`DEV_ENVIRONMENT` in the repo-root `.env` (gitignored, per-machine — `ARCHOS`
on one box, `HEPHAESTUS` on the other).

Why: this project is developed across two machines with separate local dev
databases. When work — or data — lives on only one machine, "which machine did
this?" is a real question. This puts the answer in `git log` and every PR:

```
git log --grep 'Dev-Environment: ARCHOS'
```

The hook is deliberately quiet and safe:
- Skips merge, squash, and amend/`-c` commits (only stamps freshly authored ones).
- No-ops if `.env` is missing or `DEV_ENVIRONMENT` is unset — never blocks a commit.
- Won't double-stamp a message that already has the trailer.
- Reads the value without sourcing `.env`, so no env side effects.
