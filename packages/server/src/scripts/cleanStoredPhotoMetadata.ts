/**
 * @module scripts/cleanStoredPhotoMetadata
 *
 * One-off: compliance photos (JPEG, PNG) uploaded before uploads were cleaned can still carry what the camera wrote,
 * a GPS position among it, inside the stored file. The database cannot tell which, so this reads every one from storage.
 *
 * Without flags it is a dry run: it reads each photo and prints how many there are, how many carry a location, how
 * many carry other metadata only, how many are clean and how many could not be read (with their document ids). It
 * changes nothing. With --apply it also replaces each photo that carries any metadata with a cleaned copy, through
 * documentStorageService, so the cleaning is the upload path's own. The document keeps its id; the original is
 * destroyed only after the copy is stored, read back clean and the row points at it. Every step is written to
 * audit_log (metadata.job = "photo-metadata-cleanup"). Photos that cannot be read are left as they are.
 *
 * It stops at the first storage error. Run it again: it first finishes anything the stopped run left half done, then
 * skips photos that are already clean, so it is safe to repeat. Run one copy at a time.
 *
 * Known window: once --apply has moved a document to its cleaned copy, a client that retries a create for that document
 * with the old file id may get 409 CONFLICT. Run --apply when few phone uploads are in flight; a client that gets the
 * conflict can re-fetch its documents.
 *
 * Output is counts and document ids only. Storage settings are read as the server reads them (credential store,
 * then environment). Rows with no recorded format are counted, not read: their format is not known.
 * Not covered: PDFs; copies a storage backup may keep of a destroyed original.
 *
 * Run (dev first, dry run first; prod after a database backup):
 *   dev  — ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/cleanStoredPhotoMetadata.ts
 *          ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server exec tsx src/scripts/cleanStoredPhotoMetadata.ts --apply
 *   prod — APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/cleanStoredPhotoMetadata.ts
 *          APP_ENV=prod pnpm --filter @culinaire/server exec tsx src/scripts/cleanStoredPhotoMetadata.ts --apply
 */
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

const { cleanStoredPhotos, documentStorage, finishInterruptedCleanups, listStoredPhotos } = await import(
  "../services/photoMetadataCleanupService.js"
);

const args = process.argv.slice(2);
if (args.some((a) => a !== "--apply")) {
  console.error("Usage: cleanStoredPhotoMetadata.ts [--apply]");
  process.exit(2);
}
const apply = args.includes("--apply");

async function main(): Promise<void> {
  if (apply) {
    const finished = await finishInterruptedCleanups(documentStorage);
    if (finished) console.log(`Finished ${finished} file removal(s) left by an earlier run.`);
  }
  const { photos, formatNotRecorded } = await listStoredPhotos();
  const r = await cleanStoredPhotos(photos, documentStorage, apply);
  if (apply) await finishInterruptedCleanups(documentStorage);

  console.log(`Stored compliance photos (jpg, png): ${r.total}`);
  console.log(`  carry a location: ${r.location}`);
  console.log(`  carry other metadata only: ${r.otherMetadata}`);
  console.log(`  clean: ${r.clean}`);
  console.log(`  could not be read: ${r.unreadable.length}${r.unreadable.length ? ` (${r.unreadable.join(", ")})` : ""}`);
  console.log(`Rows with no recorded format, not read: ${formatNotRecorded}`);
  if (!apply) {
    console.log(`Dry run, nothing changed. --apply replaces the ${r.location + r.otherMetadata} photo(s) that carry metadata.`);
    return;
  }
  console.log(`Replaced with a cleaned copy: ${r.cleaned}`);
  if (r.changedMeanwhile.length) {
    console.log(`Changed during the run, left for the next run: ${r.changedMeanwhile.join(", ")}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // the message and code only: storage errors can carry request detail
    const code = (err as { code?: string })?.code;
    console.error(`Stopped: ${err instanceof Error ? err.message : "unknown error"}${code ? ` (${code})` : ""}`);
    console.error("Nothing is lost; run it again to continue.");
    process.exit(1);
  });
