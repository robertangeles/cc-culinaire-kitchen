/**
 * @module components/compliance/documentFormShared
 *
 * Shared between DocumentUploadForm and MyDocumentsList's DocumentEditForm —
 * both collect the same certificate metadata (issuing state, same input
 * styling), one on upload, the other on self-service edit.
 */

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"];

export const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-dark-300 bg-dark px-3 text-sm text-[#FAFAFA] placeholder:text-dark-500 focus:outline-none";
