---
title: Auto-inject shared-context on every user prompt
category: decision
created: 2026-05-03
updated: 2026-05-03
related: [[mobile-api-contract]], [[culinaire-kitchen-platform]]
---

Decision (2026-05-03): wire a `UserPromptSubmit` hook in `.claude/settings.local.json` that injects the head of `../cc-culinaire-shared-context/mobile-needs.md` and `../cc-culinaire-shared-context/decisions.md` into Claude's context before every prompt, so Claude is automatically aware when the parallel mobile session has updated either file.

## Context

Cross-repo coordination between this repo (`cc-culinaire-kitchen`, web) and the mobile repo (`cc-culinaire-kitchen-mob`) flows through markdown files in a sibling directory `../cc-culinaire-shared-context/`. The two Claude Code sessions are separate processes that don't share memory or notifications; mobile updates to `mobile-needs.md` or `decisions.md` are invisible to the web session unless something explicitly re-reads them.

Without intervention, the web user has to nudge Claude every conversation ("check mobile-needs.md") for the web side to notice cross-repo asks. That worked while the volume was low but is a coordination tax that scales poorly.

## Options considered

| Option | Trigger | Cost | Reliability |
|---|---|---|---|
| **A. Manual nudge** (status quo) | User types "check shared context" | 0 (no infra) | Depends on user remembering |
| **B. UserPromptSubmit hook** (chosen) | Every user prompt | ~10 KB context per turn (capped at 80 lines per file) | Fires every turn, deterministic |
| **C. Status-line poll** | Status line refresh interval | None to Claude's context | User sees mtime in terminal but Claude still has to be told |
| **D. Mobile session pings via decisions.md every change** | Mobile-side discipline | None on this side | Mobile side has to remember every time |
| **E. Background watcher daemon** | File mtime change | Higher infra; needs a separate process | Highest fidelity but most setup |

## Why B

- **Boring.** It's a single hook in a single file, no daemon, no MCP server, no scheduled job.
- **Deterministic.** Every prompt carries the latest content of both files. Claude can compare mtimes against what's already in conversation history and skip re-reading when nothing changed; that's a Claude-side optimization, not a hook concern.
- **Bounded.** `head -80` per file caps context cost at ~10 KB per turn. The full files can be Read explicitly when needed.
- **Cancellable.** Disabling is one edit (remove the `hooks.UserPromptSubmit` block) or one toggle in the `/hooks` UI.
- **Local-only.** Hook lives in `.claude/settings.local.json` (gitignored). It's a personal workflow choice for Robert's machine, not a team rule.

## What was rejected

- **Option C (status line)** — useful for Robert visually, but doesn't change Claude's awareness. Could be added on top later if helpful.
- **Option D (mobile-side discipline)** — fragile. The point of the shared-context folder is to take coordination off humans' shoulders.
- **Option E (background watcher)** — overkill for two files that change a handful of times per day.

## Implementation

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "shell": "bash",
            "timeout": 5,
            "command": "echo \"<system-reminder>\"; echo \"## Cross-repo shared-context (auto-injected on every prompt)\"; echo \"\"; echo \"**mobile-needs.md** (mtime: $(stat -c %y '/c/My AI Projects/cc-culinaire-shared-context/mobile-needs.md' 2>/dev/null || echo unknown))\"; echo \"---\"; head -80 '/c/My AI Projects/cc-culinaire-shared-context/mobile-needs.md' 2>/dev/null || echo \"(unavailable)\"; echo \"\"; echo \"**decisions.md** (mtime: $(stat -c %y '/c/My AI Projects/cc-culinaire-shared-context/decisions.md' 2>/dev/null || echo unknown))\"; echo \"---\"; head -80 '/c/My AI Projects/cc-culinaire-shared-context/decisions.md' 2>/dev/null || echo \"(unavailable)\"; echo \"</system-reminder>\""
          }
        ]
      }
    ]
  }
}
```

Bash via Git Bash (`shell: "bash"`). Paths use Unix-style `/c/My AI Projects/...` so Git Bash resolves them; PowerShell-style `c:\` would not work under bash.

If either file is missing, the hook prints `(unavailable)` and the conversation continues — never blocks.

## Things to watch

- **Watcher reload on first install.** Claude Code's settings watcher only watches directories that had a settings file when the session started. If the hook is added to a freshly-created `settings.local.json` mid-session, the user must open `/hooks` once (or restart) before it begins firing. Subsequent edits are picked up automatically.
- **Context cost compounds in long sessions.** ~10 KB per turn × 100 turns = 1 MB extra context across a long session. Capped at 80 lines per file specifically to keep this bounded; if context budget becomes tight the cap can be lowered.
- **Files outside the two named ones are not watched.** If the mobile session starts writing to `architecture.md`, `web-needs.md`, or any other shared-context file, this hook misses it. Add to the command if needed.

## Related

- [[mobile-api-contract]] — the contract this folder coordinates
- [[culinaire-kitchen-platform]]
