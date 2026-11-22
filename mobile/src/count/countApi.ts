import { ApiError, type ApiClient } from "../api/client";
import {
  ActiveSessionSchema,
  AreaCategorySchema,
  AreaLinesSchema,
  CountSheetsSchema,
  STOCK_TAKE_CODES,
  SubmitConflictBodySchema,
  type ActiveSession,
  type AreaCategory,
  type AreaSheet,
  type MissingItem,
  type ServerLine,
} from "@culinaire/shared/schemas/stockTake";

export type { ActiveSession, AreaCategory, AreaSheet, MissingItem };

export type ClaimResult = { status: "claimed"; categoryId: string; claimRevision: number } | { status: "held" } | { status: "submitted" };

export type SubmitResult = { ok: true } | { ok: false; missing: MissingItem[]; message: string };

const BASE = "/api/inventory/stock-takes";
const area = (name: string) => encodeURIComponent(name);

/** The stock take calls the count screens make. Anything not listed here (offline, signed out) reaches the screen as an ApiError. */
export function createCountApi(client: ApiClient) {
  return {
    activeSession(): Promise<ActiveSession | null> {
      return client.request("GET", `${BASE}/active`, { schema: ActiveSessionSchema });
    },

    async countSheets(sessionId: string): Promise<AreaSheet[]> {
      return (await client.request("GET", `${BASE}/${sessionId}/count-sheets`, { schema: CountSheetsSchema })).areas;
    },

    async areaLines(sessionId: string, areaName: string): Promise<ServerLine[]> {
      return client.request("GET", `${BASE}/${sessionId}/categories/${area(areaName)}/lines`, { schema: AreaLinesSchema });
    },

    /** Claiming is online-only. "Held" and "submitted" are answers, not errors. The server's code decides; the English text is the fallback until every server sends codes. */
    async claimArea(sessionId: string, areaName: string): Promise<ClaimResult> {
      try {
        const c = await client.request("POST", `${BASE}/${sessionId}/categories/${area(areaName)}/claim`, { schema: AreaCategorySchema });
        return { status: "claimed", categoryId: c.categoryId, claimRevision: c.claimRevision };
      } catch (err) {
        if (err instanceof ApiError && err.code === "bad_request") {
          if (err.hasCode(STOCK_TAKE_CODES.areaSubmitted) || /current status is (SUBMITTED|APPROVED)/.test(err.message)) return { status: "submitted" };
          if (err.hasCode(STOCK_TAKE_CODES.areaHeld) || /current status is IN_PROGRESS/.test(err.message)) return { status: "held" };
        }
        throw err;
      }
    },

    /** Submitting is online-only. A 409 with a `missing` list is an answer: the shared items still to count. */
    async submitArea(sessionId: string, areaName: string, claimRevision: number): Promise<SubmitResult> {
      try {
        await client.request("POST", `${BASE}/${sessionId}/categories/${area(areaName)}/submit`, { body: { claimRevision } });
        return { ok: true };
      } catch (err) {
        const conflict = err instanceof ApiError && err.code === "conflict" ? SubmitConflictBodySchema.safeParse(err.body) : null;
        if (err instanceof ApiError && conflict?.success) return { ok: false, missing: conflict.data.missing, message: err.message };
        throw err;
      }
    },
  };
}

export type CountApi = ReturnType<typeof createCountApi>;
