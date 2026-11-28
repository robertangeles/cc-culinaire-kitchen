/**
 * The receiving rules as pure functions, so the checklist screen stays a thin view. Mirrors what the
 * server enforces (SHORT needs a quantity below the order, a price change needs the price) so the
 * phone says so before the round trip; the server stays the authority.
 */
import { expiryDateProblem, formatAuDateShort, receivingText, receivingTextProblem } from "@culinaire/shared";
import { ApiError } from "../api/client";
import { parseTypedDate } from "../ui/typedDate";

export type LineStatus = "RECEIVED" | "SHORT" | "REJECTED" | "PRICE_VARIANCE" | "SUBSTITUTED";
export type RejectionReason = "quality" | "damaged" | "temperature" | "expired" | "other";

/** What the dock chef taps, in the order the web checklist offers it. */
export const REJECTION_REASONS: Array<{ value: RejectionReason; label: string }> = [
  { value: "quality", label: "Quality not acceptable" },
  { value: "damaged", label: "Damaged packaging" },
  { value: "temperature", label: "Wrong temperature" },
  { value: "expired", label: "Expired" },
  { value: "other", label: "Something else" },
];

export interface QueueItem {
  poId: string;
  poNumber: string;
  status: "SENT" | "RECEIVING";
  supplierName: string | null;
  supplierPhone: string | null;
  lineCount: number;
  expectedDeliveryDate: string | null;
  sentAt: string | null;
  storeLocationId: string;
  beingReceivedBy: { userId: number; userName: string } | null;
}

export interface ReceivingLine {
  receivingLineId: string;
  /** The purchase order line this delivery line came from (its `lineId` in the order's detail). */
  poLineId: string;
  ingredientId: string;
  ingredientName: string | null;
  orderedQty: string;
  orderedUnit: string;
  receivedQty: string;
  actualUnitCost: string | null;
  status: LineStatus;
  /** "YYYY-MM-DD"; absent from a server older than the receiving extras. */
  expiryDate?: string | null;
  lotNumber?: string | null;
}

export interface LineInput {
  status: LineStatus;
  receivedQty?: string;
  actualUnitCost?: string;
  rejectionReason?: RejectionReason;
  rejectionNote?: string;
}

/** Sent with no status: the server changes only these two and leaves the line's status and issue alone. Null clears. */
export interface DetailsInput {
  expiryDate: string | null;
  lotNumber: string | null;
}

/** "5.0000" -> "5", "2.50" -> "2.5": the server sends numerics as strings with trailing zeros. */
export function formatQty(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(Number(n.toFixed(3))) : String(value);
}

export function formatMoney(value: string | number): string {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : String(value);
}

/** Lines the chef has flagged: anything other than the default "all good". */
export const issueCount = (lines: ReceivingLine[]) => lines.filter((l) => l.status !== "RECEIVED").length;

/** Less arrived than was ordered, whatever the line's status says. */
export const isShort = (line: ReceivingLine) => Number(line.receivedQty) < Number(line.orderedQty);

/**
 * One line of plain words for the row's second line: the quantity and price the server holds, whatever
 * the status (a line flagged short and then repriced is both). `orderUnitCost` is the order's own price.
 */
export function lineSummary(line: ReceivingLine, orderUnitCost: string | null): string {
  const ordered = `${formatQty(line.orderedQty)} ${line.orderedUnit}`;
  const arrived =
    line.status === "REJECTED"
      ? `Rejected: ${ordered}`
      : Number(line.receivedQty) === Number(line.orderedQty)
        ? ordered
        : `${isShort(line) ? "Short: " : ""}${formatQty(line.receivedQty)} of ${ordered}`;
  const price = line.actualUnitCost;
  const repriced = price != null && (orderUnitCost == null || Number(price) !== Number(orderUnitCost));
  return [
    arrived,
    repriced ? `price now ${formatMoney(price)}/${line.orderedUnit}` : null,
    line.status === "SUBSTITUTED" ? "substituted" : null,
    line.expiryDate ? `use by ${formatAuDateShort(line.expiryDate)}` : null,
    line.lotNumber ? `lot ${line.lotNumber}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export const STATUS_LABEL: Record<LineStatus, string> = {
  RECEIVED: "Received",
  SHORT: "Short",
  REJECTED: "Rejected",
  PRICE_VARIANCE: "Price changed",
  SUBSTITUTED: "Substituted",
};

/** "All good" sends the status alone: the server puts back the ordered quantity and the order's price. */
export const allGood: LineInput = { status: "RECEIVED" };

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export function shortInput(entry: string, line: ReceivingLine): Checked<LineInput> {
  const qty = Number(entry);
  if (entry === "" || !Number.isFinite(qty)) return { ok: false, message: "Enter how much arrived." };
  if (qty >= Number(line.orderedQty)) {
    return { ok: false, message: `Short means less than the ${formatQty(line.orderedQty)} ${line.orderedUnit} ordered.` };
  }
  return { ok: true, value: { status: "SHORT", receivedQty: String(qty) } };
}

export function priceInput(entry: string): Checked<LineInput> {
  const price = Number(entry);
  if (entry === "" || !Number.isFinite(price)) return { ok: false, message: "Enter the price charged." };
  return { ok: true, value: { status: "PRICE_VARIANCE", actualUnitCost: String(price) } };
}

/** The expiry as typed on the number pad (DD/MM/YYYY, blank for none) and the lot, checked by the server's own rules. */
export function detailsInput(typedExpiry: string, lot: string, receivedAt: string, lineStatus: string): Checked<DetailsInput> {
  let expiryDate: string | null = null;
  if (typedExpiry.trim() !== "") {
    expiryDate = parseTypedDate(typedExpiry);
    if (!expiryDate) return { ok: false, message: "Enter the expiry date as DD/MM/YYYY." };
  }
  const problem = (expiryDate ? expiryDateProblem(expiryDate, receivedAt, lineStatus) : null) ?? receivingTextProblem("lot", lot);
  if (problem) return { ok: false, message: problem.message };
  return { ok: true, value: { expiryDate, lotNumber: receivingText(lot) } };
}

export const rejectInput = (reason: RejectionReason, note: string): LineInput => ({
  status: "REJECTED",
  rejectionReason: reason,
  ...(note.trim() ? { rejectionNote: note.trim().slice(0, 500) } : {}),
});

/** What to tell the chef: the server's own sentence, except where the client's is plainer. */
export function failureMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (err.code === "forbidden" && !err.hasCode("LOCATION_NOT_ALLOWED")) return "You don't have permission to receive deliveries.";
  return err.message;
}

/** A confirm or cancel the server refused because the delivery already finished (another phone, or a retry that did land). Null for any other failure. */
export function finishedElsewhere(err: unknown): { title: string; message: string } | null {
  if (!(err instanceof ApiError)) return null;
  if (err.hasCode("ALREADY_CONFIRMED")) return { title: "Already done", message: "This delivery was already confirmed." };
  // The only other state a session leaves ACTIVE for is CANCELLED.
  if (err.hasCode("INVALID_STATE")) return { title: "Delivery cancelled", message: "This delivery was cancelled on another phone. Nothing was added to stock." };
  return null;
}

export interface ConfirmResult {
  poStatus: "RECEIVED" | "PARTIAL_RECEIVED";
  discrepancyCount: number;
  isPerfectDelivery: boolean;
}

export function confirmedMessage(result: ConfirmResult): { title: string; detail: string } {
  if (result.isPerfectDelivery) return { title: "Delivery received", detail: "Everything arrived as ordered." };
  const issues = `${result.discrepancyCount} ${result.discrepancyCount === 1 ? "issue" : "issues"} recorded.`;
  return result.poStatus === "PARTIAL_RECEIVED"
    ? { title: "Delivery received, with a shortfall", detail: `${issues} This order is closed as partial; order the balance on a new purchase order.` }
    : { title: "Delivery received", detail: `${issues} Stock is updated.` };
}

/**
 * Expected-delivery wording for a queue row: "Today", "Tomorrow", "Overdue", else the date.
 * The server stores the day typed on the order as UTC midnight, so its calendar day is read from the
 * UTC parts and compared with the phone's own today; read in local time it is a day early west of UTC.
 */
export function expectedLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const expected = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((expected - today) / 86_400_000);
  if (days === 0) return "Expected today";
  if (days === 1) return "Expected tomorrow";
  if (days < 0) return "Overdue";
  return `Expected ${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`;
}
