/** What the documents screens show and check, as pure functions. Dates are calendar days. */

import { formatAuDate } from "@culinaire/shared";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, NUDGE_ELIGIBLE_AFTER_HOURS, type MyDocument } from "@culinaire/shared/schemas/compliance";
import { ApiError } from "../api/client";
import { parseTypedDate } from "../ui/typedDate";
import type { DocumentFields } from "./complianceApi";

export const OTHER = "Other";
export const TYPES = DOCUMENT_TYPES;
export const NO_STATE = "Not sure";

/** The server's rule: only what a manager has not signed off yet can be changed or deleted by the person. */
export const canChange = (d: MyDocument) => d.verificationStatus === "Pending" || d.verificationStatus === "Rejected";

/** Past its expiry day, whatever the status still says. `today` is the venue's day. */
export const isExpired = (d: MyDocument, today: string) => d.verificationStatus === "Expired" || (d.expiryDate !== null && d.expiryDate.slice(0, 10) < today && d.verificationStatus !== "Archived");

const ASKS = ["Rejected", "Expired", "Requires Renewal"];
export const needsYou = (d: MyDocument, today: string) => ASKS.includes(d.verificationStatus) || isExpired(d, today);

export function statusLabel(d: MyDocument, today: string): string {
  if (d.verificationStatus === "Rejected") return "Not accepted";
  if (isExpired(d, today)) return "Expired";
  if (d.verificationStatus === "Pending") return "With your manager";
  if (d.verificationStatus === "Requires Renewal") return "Renew it";
  return d.verificationStatus || "Unknown";
}

export const expiryLine = (d: MyDocument, today: string) => (d.expiryDate ? `${d.expiryDate.slice(0, 10) < today ? "Expired" : "Expires"} ${formatAuDate(d.expiryDate.slice(0, 10))}` : "No expiry date");

/** What the person has to do first, then what is with the manager, then the rest. The server's order (newest first) is kept inside each. */
export function documentSections(docs: MyDocument[], today: string): { title: string; docs: MyDocument[] }[] {
  const asks = docs.filter((d) => needsYou(d, today));
  const pending = docs.filter((d) => !asks.includes(d) && d.verificationStatus === "Pending");
  const rest = docs.filter((d) => !asks.includes(d) && !pending.includes(d));
  return [
    { title: "Needs you", docs: asks },
    { title: "With your manager", docs: pending },
    { title: "On record", docs: rest },
  ].filter((s) => s.docs.length > 0);
}

/** A reminder can go once the document has waited two days; the server checks again and allows one a day. */
export const canNudge = (d: MyDocument, now: number) => d.verificationStatus === "Pending" && now - Date.parse(d.uploadedAt) >= NUDGE_ELIGIBLE_AFTER_HOURS * 3_600_000;

const plain = (s: string) => s.trim().toLowerCase().replace(/[.\s]+/g, "");

/**
 * The type a form means, or why not. A name typed under Other that is really one of the list ("R.S.A") is refused: the server compares
 * types letter by letter, so it would never count as the document a role asks for.
 */
export function readType(picked: string | null, other: string): { type: string } | { error: string | null } {
  if (!picked) return { error: null };
  if (picked !== OTHER) return { type: picked };
  const typed = other.trim();
  if (!typed) return { error: null };
  const same = TYPES.find((t) => t !== OTHER && plain(t) === plain(typed));
  return same ? { error: `Did you mean "${same}"? Pick it from the list instead.` } : { type: typed };
}

/** As typed: day-first dates, "" for none. */
export interface FieldsForm {
  documentNumber: string;
  issued: string;
  expires: string;
  state: string | null;
}

export function readFields(form: FieldsForm): { fields: DocumentFields } | { error: string } {
  const issueDate = form.issued.trim() === "" ? null : parseTypedDate(form.issued);
  if (form.issued.trim() !== "" && !issueDate) return { error: "Enter the issue date as day, month, year, such as 08/07/2026, or leave it empty." };
  const expiryDate = form.expires.trim() === "" ? null : parseTypedDate(form.expires);
  if (form.expires.trim() !== "" && !expiryDate) return { error: "Enter the expiry date as day, month, year, such as 08/07/2028, or leave it empty." };
  if (issueDate && expiryDate && expiryDate < issueDate) return { error: "The expiry date can't be before the issue date." };
  return { fields: { documentNumber: form.documentNumber.trim() || null, issueDate, expiryDate, issuingJurisdiction: form.state && form.state !== NO_STATE ? form.state : null } };
}

export const TOO_BIG = `That photo is over ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB. Take a new one, or choose a smaller photo.`;
export const UNSUPPORTED = "That file's format can't be used. Choose a JPEG or PNG photo.";
export const CAMERA_DENIED = "The camera isn't allowed for CulinAIre Kitchen. Allow it in your phone's settings, or choose a photo instead.";

/** One clear sentence for a photo that could not be sent, by the status of the answer. */
export function uploadMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "network" || err.code === "timeout") return "The photo wasn't sent: no connection. It isn't saved on this phone. Find a signal and tap Send the photo again.";
    if (err.status === 413) return TOO_BIG;
    if (err.status === 415) return UNSUPPORTED;
    if (err.status === 503) return "Your kitchen can't take documents right now. Tell your manager, and try again later.";
    if (err.code === "rate_limited") return "Too many tries. Wait a minute and try again.";
    if (err.code === "bad_request" || err.code === "forbidden") return err.message;
  }
  return "The photo couldn't be sent. Try again.";
}
