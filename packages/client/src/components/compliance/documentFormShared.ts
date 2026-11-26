/**
 * @module components/compliance/documentFormShared
 *
 * Shared between DocumentUploadForm and MyDocumentsList's DocumentEditForm —
 * both collect the same certificate metadata (issuing state, same input
 * styling), one on upload, the other on self-service edit. VenueDocumentForm
 * uses withoutPhotoMetadata too.
 */

import { stripMetadata } from "@culinaire/shared";

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

export const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-dark-300 bg-dark px-3 text-sm text-[#FAFAFA] placeholder:text-dark-500 focus:outline-none";

/**
 * The file to send: a JPEG or PNG without the place, time and device the camera wrote into it (the rotation is
 * kept); anything else as chosen. A photo that cannot be cleaned goes as chosen and the server, which also
 * cleans every photo, refuses it.
 */
export async function withoutPhotoMetadata(file: File): Promise<File> {
  const clean = stripMetadata(new Uint8Array(await file.arrayBuffer()));
  return clean ? new File([new Uint8Array(clean)], file.name, { type: file.type }) : file;
}
