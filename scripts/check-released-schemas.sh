#!/usr/bin/env bash
# Does the app that is already in people's hands still work against this server?
#
# Installed phones lag the server by days (store review) or weeks (people who do not update), and the server
# deploys on every merge. The phone parses replies with the zod schemas in packages/shared/src/schemas, so the
# schemas from the last store release are what those phones run. This puts them back in place of the current
# ones and runs the phone's end-to-end flow (the phone's own client, session and count code) against this
# server: a reply the old schemas cannot read fails the run before it reaches anyone.
#
# Release convention: when a build goes to the stores, tag that commit `mobile-v<version>` (for example
# mobile-v0.1.0). No such tag yet means nothing is installed to protect, and the check passes.
#
# It replaces packages/shared/src/schemas in the working tree, so it only runs in CI (a throwaway checkout).
# Overrides, for trying it: RELEASED_REF=<ref> instead of the latest tag, E2E_CMD=<command> instead of the e2e run.
# Limit: schema files added since the release stay as they are; only files that existed at the tag are put back.
set -euo pipefail

[ -n "${CI:-}" ] || { echo "Refusing to replace packages/shared/src/schemas outside CI (set CI=1 to run it anyway)." >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"

# A failed fetch must not switch the check off: carry on only with release tags that are already here.
if ! git fetch --tags --force --quiet origin; then
  [ -n "$(git tag --list 'mobile-v*')" ] || { echo "Could not fetch release tags and none are present locally: cannot tell whether a release exists." >&2; exit 1; }
  echo "Could not fetch release tags; using the mobile-v* tags already present locally." >&2
fi
ref="${RELEASED_REF:-$(git tag --list 'mobile-v*' --sort=-v:refname | head -n 1)}"
if [ -z "$ref" ]; then
  echo "No mobile-v* release tag yet: no installed app to check against."
  exit 0
fi

echo "Checking the schemas released as $ref against this server."
git cat-file -e "$ref:packages/shared/src/schemas" 2>/dev/null || { echo "$ref has no packages/shared/src/schemas: it predates the shared schemas, so there is nothing to put back. Tag a newer release." >&2; exit 1; }
git restore --source="$ref" -- packages/shared/src/schemas
pnpm --filter @culinaire/shared build
${E2E_CMD:-pnpm --filter @culinaire/mobile run check:e2e}
