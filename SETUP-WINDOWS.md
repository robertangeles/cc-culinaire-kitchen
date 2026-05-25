# Windows setup — syncing after the cross-platform refresh

This repo now runs on Linux and Windows from a shared `main`. After pulling the
cross-platform commit (`58f8aca`), the Windows machine needs a one-time refresh
so its working tree matches the new `.gitattributes` contract (LF in the repo,
CRLF only for `.bat` / `.cmd` / `.ps1`).

Run from PowerShell or Git Bash inside the repo root.

## 1. Pull and normalise

```powershell
git pull origin main

# .gitattributes wins, but make sure git's own translation doesn't fight it.
git config core.autocrlf false

# Rewrite every working-tree file to match the new normalisation.
# Safe — no content changes, only line endings.
git rm --cached -r .
git reset --hard HEAD
```

If `git status` shows any phantom diffs after this, run `git add --renormalize .`
once and commit the result.

## 2. Reinstall node_modules

The Linux box rebuilt native modules (esbuild, bcrypt, tesseract.js). Windows
needs its own native binaries.

```powershell
Remove-Item -Recurse -Force node_modules, .turbo, tsconfig.tsbuildinfo, packages\*\node_modules, packages\*\.turbo, packages\*\tsconfig.tsbuildinfo -ErrorAction SilentlyContinue
pnpm install
```

## 3. Restore the SessionStart hook (cross-platform Node version)

`.claude/` is gitignored, so the new hook does not arrive via `git pull`. Copy
the file below to `.claude/hooks/mobile-needs-on-session-start.mjs` (already
present on Linux at that path):

> The full source is committed at `.claude/hooks/mobile-needs-on-session-start.mjs`
> on the Linux machine. `scp` or copy-paste it across once.

Then edit `.claude/settings.json` and replace the PowerShell `SessionStart`
hook block with:

```json
"SessionStart": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "node .claude/hooks/mobile-needs-on-session-start.mjs",
        "timeout": 10
      }
    ]
  }
],
```

The Node version reads `cc-culinaire-shared-context/mobile-needs.md` (sibling
of the repo) and writes its sidecar to `os.tmpdir()` — works identically on
Windows and Linux. The old `.ps1` can be deleted once you've switched.

## 4. Pin Node version

```powershell
# If you use nvm-windows:
nvm install 22
nvm use 22
```

The repo now ships `.nvmrc` (= `22`) so future contributors get the same.

## 5. Verify

```powershell
pnpm tsc:check
pnpm test
pnpm build
```

All three should pass on a clean machine. If any fail with native-module
errors (`.node` binary mismatch), wipe `node_modules` again and reinstall.

## Layout reminder

Both machines expect the shared-context directory as a **sibling** of the repo,
not inside it:

```
My AI Projects/
  cc-culinaire-kitchen/             <-- this repo
  cc-culinaire-shared-context/      <-- mobile-needs.md, decisions.md, etc.
  cc-culinaire-kitchen-mob/         <-- mobile counterpart (optional)
```

If `cc-culinaire-shared-context/` is missing, the SessionStart hook no-ops
silently — but the cross-repo shared-context auto-inject at the top of each
prompt will say `(unavailable)`.
