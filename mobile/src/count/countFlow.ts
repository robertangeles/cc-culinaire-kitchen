/**
 * What the count screens show, derived from three sources and nothing else: the area's sheet (from the
 * download), the lines the server already holds, and this phone's outbox. All plain functions.
 */

import type { ServerLine, SheetItem } from "@culinaire/shared/schemas/stockTake";
import type { AttentionReason, OutboxEntry } from "../outbox/outbox";

export type { ServerLine, SheetItem };

/** The three save states from the design, plus the one that needs the chef. */
export type SaveState = "saved_on_phone" | "waiting_to_send" | "accepted" | "needs_attention";

export interface Answer {
  rawQty: number;
  countedUnit: string;
  saveState: SaveState;
  attention?: { reason: AttentionReason; message: string };
  /** The outbox entry, for retry and discard. */
  entryId?: string;
}

/** The newest source for each item wins: the phone's own count, else the server's line. */
export function buildAnswers(serverLines: ServerLine[], entries: OutboxEntry[]): Map<string, Answer> {
  const answers = new Map<string, Answer>();
  for (const l of serverLines) answers.set(l.ingredientId, { rawQty: l.rawQty, countedUnit: l.countedUnit, saveState: "accepted" });

  for (const e of [...entries].sort((a, b) => a.createdAt - b.createdAt)) {
    if (e.status === "DISCARDED") continue;
    const { ingredientId, rawQty, countedUnit } = e.command;
    if (e.status === "NEEDS_ATTENTION") {
      answers.set(ingredientId, { rawQty, countedUnit, saveState: "needs_attention", attention: e.attention, entryId: e.id });
    } else {
      const saveState: SaveState = e.status === "ACCEPTED" ? "accepted" : e.status === "SENDING" ? "waiting_to_send" : "saved_on_phone";
      answers.set(ingredientId, { rawQty, countedUnit, saveState });
    }
  }
  return answers;
}

export type ReviewKind = "counted" | "not_counted" | "shared_gap" | "needs_attention";

export interface ReviewRow {
  ingredientId: string;
  name: string;
  kind: ReviewKind;
  answer?: Answer;
  alsoIn: string[];
}

/** One row per item for the end-of-area list. A shared item with no count here is a gap (enter 0 if none). */
export function reviewRows(items: SheetItem[], answers: Map<string, Answer>): ReviewRow[] {
  return items.map((item) => {
    const answer = answers.get(item.ingredientId);
    const kind: ReviewKind = answer ? (answer.saveState === "needs_attention" ? "needs_attention" : "counted") : item.alsoIn.length > 0 ? "shared_gap" : "not_counted";
    return { ingredientId: item.ingredientId, name: item.ingredientName, kind, answer, alsoIn: item.alsoIn };
  });
}

export interface SubmitCheck {
  ok: boolean;
  gaps: number;
  needsAttention: number;
  waiting: number;
}

/** Submit is online-only and waits until every count has reached the server and no shared item is missing. */
export function submitCheck(rows: ReviewRow[]): SubmitCheck {
  const gaps = rows.filter((r) => r.kind === "shared_gap").length;
  const needsAttention = rows.filter((r) => r.kind === "needs_attention").length;
  const waiting = rows.filter((r) => r.answer?.saveState === "saved_on_phone" || r.answer?.saveState === "waiting_to_send").length;
  return { ok: gaps + needsAttention + waiting === 0, gaps, needsAttention, waiting };
}

/** A count the server has (or will accept). A stuck count is not counted yet: the chef still has to deal with it. */
const isCounted = (a: Answer | undefined) => a !== undefined && a.saveState !== "needs_attention";

/** Index of the first item still to count (including a stuck one), or -1 when every item is counted. */
export function firstUncounted(items: SheetItem[], answers: Map<string, Answer>): number {
  return items.findIndex((i) => !isCounted(answers.get(i.ingredientId)));
}

export function progress(items: SheetItem[], answers: Map<string, Answer>): { counted: number; total: number } {
  return { counted: items.filter((i) => isCounted(answers.get(i.ingredientId))).length, total: items.length };
}

export interface AreaSummary {
  name: string;
  status: string;
  counted: number;
  total: number;
  needsAttention: number;
  sharesWith: string[];
  /** Name of the other chef holding this area, or null when free or held by the signed-in chef. */
  heldBy: string | null;
}

/** One row of the areas list. */
export function summarizeArea(args: {
  items: SheetItem[];
  category: { categoryName: string; categoryStatus: string; claimedByUserId: number | null; claimedByUserName?: string | null };
  answers: Map<string, Answer>;
  currentUserId: number;
}): AreaSummary {
  const { items, category, answers, currentUserId } = args;
  const { counted, total } = progress(items, answers);
  const heldByOther = category.claimedByUserId !== null && category.claimedByUserId !== currentUserId;
  return {
    name: category.categoryName,
    status: category.categoryStatus,
    counted,
    total,
    needsAttention: [...answers.values()].filter((a) => a.saveState === "needs_attention").length,
    sharesWith: [...new Set(items.flatMap((i) => i.alsoIn))],
    heldBy: heldByOther ? (category.claimedByUserName ?? "another chef") : null,
  };
}
