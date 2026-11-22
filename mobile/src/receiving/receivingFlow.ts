/**
 * The receiving rules as pure functions, so the checklist screen stays a thin view. Mirrors what the
 * server enforces (SHORT needs a quantity below the order, a price change needs the price) so the
 * phone says so before the round trip; the server stays the authority.
 */
import { ApiError } from "../api/client";

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
  beingReceivedBy: { userId: number; userName: string; sessionId: string; startedAt: string } | null;
}

export interface ReceivingLine {
  receivingLineId: string;
  ingredientId: string;
  ingredientName: string | null;
  orderedQty: string;
  orderedUnit: string;
  receivedQty: string;
  actualUnitCost: string | null;
  status: LineStatus;
}

export interface LineInput {
  status: LineStatus;
  receivedQty?: string;
  actualUnitCost?: string;
  rejectionReason?: RejectionReason;
  rejectionNote?: string;
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

/** One line of plain words for the row's second line. */
export function lineSummary(line: ReceivingLine): string {
  const ordered = `${formatQty(line.orderedQty)} ${line.orderedUnit}`;
  switch (line.status) {
    case "SHORT":
      return `Short: ${formatQty(line.receivedQty)} of ${ordered}`;
    case "REJECTED":
      return `Rejected: ${ordered}`;
    case "PRICE_VARIANCE":
      return `${ordered}, price now ${formatMoney(line.actualUnitCost ?? 0)}/${line.orderedUnit}`;
    case "SUBSTITUTED":
      return `${ordered}, substituted`;
    default:
      return ordered;
  }
}

export const STATUS_LABEL: Record<LineStatus, string> = {
  RECEIVED: "Received",
  SHORT: "Short",
  REJECTED: "Rejected",
  PRICE_VARIANCE: "Price changed",
  SUBSTITUTED: "Substituted",
};

/**
 * "All good" sends the ordered quantity along with the status. The server also resets it, but a delivery
 * the chef marked short and then good again must never stock the short quantity if that fix is absent.
 */
export const allGood = (line: ReceivingLine): LineInput => ({ status: "RECEIVED", receivedQty: line.orderedQty });

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

export const rejectInput = (reason: RejectionReason, note: string): LineInput => ({
  status: "REJECTED",
  rejectionReason: reason,
  ...(note.trim() ? { rejectionNote: note.trim().slice(0, 500) } : {}),
});

/** The server's `code` on a 400, when it sent one. */
export function serverCode(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const code = (err.body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** What to tell the chef. The server's own sentence is kept for the rules it words well; the rest fall back to the client's. */
export function failureMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  if (serverCode(err) === "UNIT_NOT_CONVERTIBLE") return err.message;
  if (err.code === "forbidden") return "You don't have permission to receive deliveries.";
  return err.message;
}

/** A confirm the server refused because the session already finished (another phone, or a retry that did land). */
export const isAlreadyDone = (err: unknown) => err instanceof ApiError && (serverCode(err) === "ALREADY_CONFIRMED" || err.code === "conflict");

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

/** Expected-delivery wording for a queue row: "Today", "Tomorrow", "Overdue", else the date. */
export function expectedLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86_400_000);
  if (days === 0) return "Expected today";
  if (days === 1) return "Expected tomorrow";
  if (days < 0) return "Overdue";
  return `Expected ${date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}`;
}
