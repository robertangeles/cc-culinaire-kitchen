/** What the order screens show and allow, as pure functions. The server stays the authority on every rule here. */

import { SUPPLIER_EMAIL_WINDOW_MS } from "@culinaire/shared";
import type { Discrepancy, OrderDetail, OrderLine, OrderSummary } from "@culinaire/shared/schemas/purchasing";
import { ApiError } from "../api/client";
import type { AuthUser } from "../api/auth";
import { formatMoney, formatQty } from "../receiving/receivingFlow";
import { hasAnyPermission } from "../shell/tabs";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending approval",
  SENT: "Sent",
  RECEIVING: "Receiving",
  RECEIVED: "Received",
  PARTIAL_RECEIVED: "Part received",
  CANCELLED: "Cancelled",
};
/** A status this version does not know is shown as the server wrote it, never guessed. */
export const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

const LINE_LABEL: Record<string, string> = { RECEIVED: "Received", SHORT: "Short", REJECTED: "Rejected", PARTIAL: "Part received", CANCELLED: "Cancelled" };

/** The web's filters, in its order. "Received" also finds the part-received ones, which the web lists only under All. */
export const FILTERS = [
  { label: "All", statuses: [] },
  { label: "Draft", statuses: ["DRAFT"] },
  { label: "Pending", statuses: ["PENDING_APPROVAL"] },
  { label: "Sent", statuses: ["SENT"] },
  { label: "Receiving", statuses: ["RECEIVING"] },
  { label: "Received", statuses: ["RECEIVED", "PARTIAL_RECEIVED"] },
  { label: "Cancelled", statuses: ["CANCELLED"] },
] as const;
export type FilterLabel = (typeof FILTERS)[number]["label"];

export const PENDING = ["PENDING_APPROVAL"] as const;

/** What a person may do, by the key the server asks for on each route (hiding a button is never the check). */
export interface OrderRights {
  list: boolean;
  create: boolean;
  submit: boolean;
  approve: boolean;
  receive: boolean;
  /** Reorder. Also what opens the order guides. */
  draft: boolean;
  credit: boolean;
}
export function orderRights(user: AuthUser): OrderRights {
  const has = (...keys: string[]) => hasAnyPermission(user, keys);
  return {
    list: has("inventory:count", "purchasing:receive"),
    // Creating also needs the suppliers and items, which the server opens to inventory:count.
    create: has("inventory:manage") && has("inventory:count"),
    submit: has("purchasing:submit"),
    approve: has("purchasing:approve"),
    receive: has("purchasing:receive"),
    draft: has("purchasing:draft"),
    credit: has("purchasing:credit"),
  };
}

export interface OrderActions {
  submit: boolean;
  cancel: boolean;
  approve: boolean;
  /** An approver's own order while someone else can approve it: the server refuses it, so the reason is shown instead of the button. */
  approveBlocked: boolean;
  reject: boolean;
  receive: boolean;
  email: boolean;
  reorder: boolean;
}

/** The buttons an order offers: the web's, by status, less the ones the person's permissions would be refused on. */
export function orderActions(order: OrderSummary, rights: OrderRights, now: number): OrderActions {
  const pending = order.status === "PENDING_APPROVAL" && rights.approve;
  const received = order.status === "RECEIVED" || order.status === "PARTIAL_RECEIVED";
  return {
    submit: order.status === "DRAFT" && rights.submit,
    cancel: order.status === "DRAFT" && rights.create,
    approve: pending && order.canApprove !== false,
    approveBlocked: pending && order.canApprove === false,
    reject: pending,
    receive: (order.status === "SENT" || order.status === "RECEIVING") && rights.receive,
    // The ordering method is in the list only: unknown (opened from a notification) offers it, and the server answers for a supplier that does not take email.
    email: order.status === "SENT" && rights.submit && (order.supplierOrderingMethod === null || order.supplierOrderingMethod === "email") && !emailedJustNow(order.supplierEmailedAt, now),
    reorder: received && rights.draft,
  };
}

/** Emailed inside the server's resend window: another send now would be refused as a double tap. */
export const emailedJustNow = (at: string | null, now: number) => at !== null && now - new Date(at).getTime() < SUPPLIER_EMAIL_WINDOW_MS;

/** How long an order has waited for approval. The web's cues: over a day is amber, over two is red. */
export function waiting(submittedAt: string | null, now: number): { label: string; tone: "calm" | "amber" | "red" } | null {
  if (!submittedAt) return null;
  const ms = now - new Date(submittedAt).getTime();
  if (!Number.isFinite(ms)) return null;
  const hours = Math.max(0, Math.round(ms / 3_600_000));
  return { label: hours < 1 ? "Waiting under an hour" : `Waiting ${hours} h`, tone: hours > 48 ? "red" : hours > 24 ? "amber" : "calm" };
}

/** Longest wait first. */
export const byWait = (orders: OrderSummary[]) => [...orders].sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));

export const dayLabel = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/** An expected delivery is a calendar day the server keeps as UTC midnight: read in local time it is a day early west of UTC. */
export const calendarDay = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};

/** Money the server sent, or null for a figure it left out: hidden is never shown as zero. */
export const money = (n: number | null) => (n === null ? null : formatMoney(n));
export const itemCount = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

export interface LineFacts {
  ordered: string;
  received: string | null;
  price: string | null;
  /** The price paid at the door, when it was not the order's. */
  paid: { text: string; up: boolean } | null;
  status: string | null;
}

export function lineFacts(line: OrderLine): LineFacts {
  const repriced = line.actualUnitCost !== null && line.actualUnitCost !== line.unitCost;
  return {
    ordered: `${formatQty(line.orderedQty)} ${line.orderedUnit}`,
    received: line.receivedQty === null ? null : `${formatQty(line.receivedQty)} received`,
    price: line.unitCost === null ? null : `${formatMoney(line.unitCost)} per ${line.orderedUnit}`,
    paid: repriced ? { text: `paid ${formatMoney(line.actualUnitCost!)}`, up: line.actualUnitCost! > (line.unitCost ?? 0) } : null,
    status: LINE_LABEL[line.lineStatus] ?? null,
  };
}

/** Who signed for the delivery, and when. Every line of one receipt carries the same, so the first received line speaks for it. */
export function receipt(order: OrderDetail): string | null {
  const line = order.lines.find((l) => l.receivedDttm);
  const when = dayLabel(line?.receivedDttm ?? null);
  return when && `Received${line!.receivedByUserName ? ` by ${line!.receivedByUserName}` : ""} on ${when}`;
}

const REASONS: Record<string, string> = { quality: "quality not acceptable", damaged: "damaged", temperature: "wrong temperature", expired: "expired", other: "another reason" };

/** One line of plain words for a discrepancy. */
export function discrepancyText(d: Discrepancy): string {
  const qty = (n: number | null) => `${formatQty(n ?? 0)} ${d.orderedUnit}`.trim();
  switch (d.type) {
    case "SHORT":
      return `Short: ${qty(d.shortageQty)} missing of ${qty(d.orderedQty)}`;
    case "REJECTED":
      return `Rejected: ${d.rejectionNote ?? REASONS[d.rejectionReason ?? ""] ?? "no reason given"}`;
    case "PRICE_VARIANCE":
      return d.poUnitCost !== null && d.actualUnitCost !== null
        ? `Price changed: ${formatMoney(d.poUnitCost)} ordered, ${formatMoney(d.actualUnitCost)} charged`
        : "Price changed";
    case "SUBSTITUTION":
    case "SUBSTITUTED":
      return `Substituted: ${qty(d.orderedQty)} ordered`;
    default:
      return d.type;
  }
}

/** What to tell the person, and what it says about the order: "moved" means someone or something else already changed it. */
export interface OrderFailure {
  message: string;
  /** The request may have reached the server: look before trying again. */
  unsure: boolean;
  moved: boolean;
}

/** `doing` finishes the sentence "... needs a connection" ("Submitting an order"). */
export function orderFailure(err: unknown, doing: string): OrderFailure {
  if (!(err instanceof ApiError)) return { message: "Something went wrong. Try again.", unsure: false, moved: false };
  if (err.code === "network") return { message: `Can't reach the server. ${doing} needs a connection.`, unsure: true, moved: false };
  if (err.code === "timeout") return { message: "The server took too long to answer. Check the order before trying again.", unsure: true, moved: false };
  if (err.hasCode("INVALID_STATE")) return { message: "This order has changed since you opened it. Here is how it stands now.", unsure: false, moved: true };
  if (err.code === "forbidden" && !err.serverCode) return { message: "You don't have permission for that.", unsure: false, moved: false };
  return { message: err.message, unsure: err.code === "server" && !err.serverCode, moved: false };
}

/** A list that could not be loaded. */
export const loadMessage = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Try again.");

/** The credit to claim, checked as the server will: at least a cent, kept to the cent, no more than the discrepancy is worth. */
export function creditAmount(entry: string, max: number): { ok: true; value: number } | { ok: false; message: string } {
  const typed = entry.trim().replace(",", ".").replace(/^\$/, "");
  const n = Math.round(Number(typed) * 100) / 100;
  if (typed === "" || !Number.isFinite(n) || n < 0.01) return { ok: false, message: "Enter the amount the supplier credited." };
  if (n > max) return { ok: false, message: `The credit can't be more than ${formatMoney(max)}, what this is worth.` };
  return { ok: true, value: n };
}
