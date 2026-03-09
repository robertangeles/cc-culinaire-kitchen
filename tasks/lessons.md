# CulinAIre Kitchen — Lessons Learned

Format: Problem / Fix / Rule

---

## 1. Never use Google Drive for Node.js projects
- **Problem**: pnpm install failed repeatedly — Google Drive doesn't support symlinks, which pnpm (and npm workspaces) require for linking packages
- **Fix**: Moved project to local drive `D:\My AI Projects\cc-culinaire-kitchen\`. Install completed in 32s (vs hanging for 10+ minutes on Google Drive)
- **Rule**: Always use a local filesystem for Node.js projects. Use Git + GitHub for backup instead of cloud sync drives
