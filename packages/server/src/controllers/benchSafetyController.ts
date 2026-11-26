/**
 * @module controllers/benchSafetyController
 *
 * Blocking, reporting and the moderators' queue on The Bench. Every refusal carries a `code`.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { BenchReportRequestSchema } from "@culinaire/shared/schemas/bench";
import { blockPerson, listBlocked, unblockPerson } from "../services/benchBlockService.js";
import { actOnReport, listReports, reportBench, type ReportAction } from "../services/benchReportService.js";
import { noteBlock } from "../services/benchSocketService.js";

const personId = z.coerce.number().int().positive().max(2_147_483_647);
const invalid = (res: Response, error: string) => res.status(400).json({ error, code: "VALIDATION" });

/** GET /api/bench/blocks */
export async function handleListBlocked(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listBlocked(req.user!.sub));
  } catch (err) {
    next(err);
  }
}

/** POST /api/bench/blocks { userId } */
export async function handleBlock(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = z.object({ userId: z.number().pipe(personId) }).safeParse(req.body);
    if (!parsed.success) return void invalid(res, "userId required");
    await blockPerson(req.user!.sub, parsed.data.userId);
    noteBlock(req.user!.sub, parsed.data.userId, true);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/bench/blocks/:userId */
export async function handleUnblock(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = personId.safeParse(req.params.userId);
    if (!parsed.success) return void invalid(res, "Invalid user ID");
    await unblockPerson(req.user!.sub, parsed.data);
    noteBlock(req.user!.sub, parsed.data, false);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** POST /api/bench/reports { messageId | userId, reason, note? } */
export async function handleReport(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = BenchReportRequestSchema.safeParse(req.body);
    if (!parsed.success) return void invalid(res, "Choose a reason, and report one message or one person");
    res.status(201).json(await reportBench(req.user!.sub, parsed.data));
  } catch (err) {
    next(err);
  }
}

/** GET /api/bench/reports?status=open|closed (bench:moderate) */
export async function handleListReports(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listReports(req.query.status === "closed" ? "closed" : "open"));
  } catch (err) {
    next(err);
  }
}

/** POST /api/bench/reports/:id/{hide,dismiss,resolve} { note? } (bench:moderate) */
export function handleReportAction(action: ReportAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return void res.status(404).json({ error: "Report not found", code: "NOT_FOUND" });
      const note = z.object({ note: z.string().trim().max(500).optional() }).safeParse(req.body ?? {});
      if (!note.success) return void invalid(res, "A note is at most 500 characters");
      await actOnReport(id.data, req.user!.sub, action, note.data.note);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  };
}
