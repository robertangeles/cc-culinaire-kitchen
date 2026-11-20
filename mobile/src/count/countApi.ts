import { ApiError, type ApiClient } from "../api/client";
import type { ServerLine, SheetItem } from "./countFlow";

export interface AreaCategory {
  categoryId: string;
  categoryName: string;
  categoryStatus: string;
  claimedByUserId: number | null;
  claimedByUserName: string | null;
  claimRevision: number;
}

export interface ActiveSession {
  sessionId: string;
  sessionStatus: string;
  countMode: "CATEGORY" | "AREA";
  locationName: string;
  categories: AreaCategory[];
}

export interface AreaSheet {
  categoryId: string;
  categoryName: string;
  items: SheetItem[];
}

export type ClaimResult = { status: "claimed"; categoryId: string; claimRevision: number } | { status: "held" } | { status: "submitted" };

export interface MissingItem {
  ingredientId: string;
  ingredientName: string;
  areaNames: string[];
}

export type SubmitResult = { ok: true } | { ok: false; missing: MissingItem[]; message: string };

const BASE = "/api/inventory/stock-takes";
const area = (name: string) => encodeURIComponent(name);

/** The stock take calls the count screens make. Anything not listed here (offline, signed out) reaches the screen as an ApiError. */
export function createCountApi(client: ApiClient) {
  return {
    async activeSession(): Promise<ActiveSession | null> {
      const s = await client.request<ActiveSession | null>("GET", `${BASE}/active`);
      return s ?? null;
    },

    async countSheets(sessionId: string): Promise<AreaSheet[]> {
      return (await client.request<{ areas: AreaSheet[] }>("GET", `${BASE}/${sessionId}/count-sheets`)).areas;
    },

    async areaLines(sessionId: string, areaName: string): Promise<ServerLine[]> {
      const rows = await client.request<Array<{ ingredientId: string; rawQty: string; countedUnit: string }>>("GET", `${BASE}/${sessionId}/categories/${area(areaName)}/lines`);
      return rows.map((r) => ({ ingredientId: r.ingredientId, rawQty: Number(r.rawQty), countedUnit: r.countedUnit }));
    },

    /** Claiming is online-only. "Held" and "submitted" are answers, not errors. */
    async claimArea(sessionId: string, areaName: string): Promise<ClaimResult> {
      try {
        const c = await client.request<AreaCategory>("POST", `${BASE}/${sessionId}/categories/${area(areaName)}/claim`);
        return { status: "claimed", categoryId: c.categoryId, claimRevision: c.claimRevision };
      } catch (err) {
        if (err instanceof ApiError && err.code === "bad_request") {
          if (/current status is (SUBMITTED|APPROVED)/.test(err.message)) return { status: "submitted" };
          if (/current status is IN_PROGRESS/.test(err.message)) return { status: "held" };
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
        const body = err instanceof ApiError ? (err.body as { missing?: MissingItem[] } | undefined) : undefined;
        if (err instanceof ApiError && err.code === "conflict" && Array.isArray(body?.missing)) {
          return { ok: false, missing: body.missing, message: err.message };
        }
        throw err;
      }
    },
  };
}

export type CountApi = ReturnType<typeof createCountApi>;
