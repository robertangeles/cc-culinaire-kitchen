/**
 * @module services/benchReportService
 *
 * Reports on The Bench, and what moderators do about them. A report keeps the message's words as they were when it was made,
 * who made it and whom it is about; only holders of `bench:moderate` (and administrators) ever read it, so the reported person
 * never learns who reported them. Every moderator action is recorded with who and when.
 */

import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { BenchReportRequest } from "@culinaire/shared/schemas/bench";
import { db } from "../db/index.js";
import { benchChannel, benchMessage, benchReport, benchReportAction, user } from "../db/schema.js";
import { AppError } from "../utils/appError.js";
import { canMeet } from "./benchBlockService.js";
import { getMessageAudience, isInAudience } from "./benchService.js";
import { announceHidden } from "./benchSocketService.js";

/** Reports one person may make in any 24 hours. */
export const REPORTS_PER_DAY = 20;

/** Stores a report of a message this person can read, or of a person they can come across. Anything else is 404, as for nothing. */
export async function reportBench(reporterId: number, { messageId, userId, reason, note }: BenchReportRequest): Promise<{ id: string }> {
  const [{ made }] = await db
    .select({ made: sql<number>`count(*)::int` })
    .from(benchReport)
    .where(and(eq(benchReport.userId, reporterId), gt(benchReport.createdAt, sql`now() - interval '1 day'`)));
  if (made >= REPORTS_PER_DAY) throw new AppError(429, "RATE_LIMITED", "You have sent a lot of reports today. Try again tomorrow.");

  let reportedUserId: number;
  let messageBody: string | null = null;
  if (messageId !== undefined) {
    const [message] = await db
      .select({ userId: benchMessage.userId, messageBody: benchMessage.messageBody, deletedInd: benchMessage.deletedInd })
      .from(benchMessage)
      .where(eq(benchMessage.messageId, messageId))
      .limit(1);
    const audience = message && !message.deletedInd ? await getMessageAudience(messageId) : null;
    if (!message || !audience || !(await isInAudience(audience, reporterId))) throw new AppError(404, "NOT_FOUND", "Message not found");
    if (message.userId === reporterId) throw new AppError(400, "VALIDATION", "You cannot report your own message");
    reportedUserId = message.userId;
    messageBody = message.messageBody;
  } else {
    if (userId === reporterId) throw new AppError(400, "VALIDATION", "You cannot report yourself");
    if (!(await canMeet(reporterId, userId!))) throw new AppError(404, "NOT_FOUND", "Person not found");
    reportedUserId = userId!;
  }

  const [row] = await db
    .insert(benchReport)
    .values({ userId: reporterId, reportedUserId, messageId: messageId ?? null, messageBody, reason, note: note || null })
    .returning({ id: benchReport.id });
  return row;
}

/** The newest 100 open reports, or the newest 100 closed ones, with what was done about each. */
export async function listReports(state: "open" | "closed") {
  const reporter = alias(user, "reporter");
  const reported = alias(user, "reported");
  const reports = await db
    .select({
      id: benchReport.id,
      status: benchReport.status,
      reason: benchReport.reason,
      note: benchReport.note,
      createdAt: benchReport.createdAt,
      reporterName: reporter.userName,
      reportedUserId: benchReport.reportedUserId,
      reportedUserName: reported.userName,
      messageId: benchReport.messageId,
      messageBody: benchReport.messageBody,
      deletedInd: benchMessage.deletedInd,
      channelName: benchChannel.channelName,
    })
    .from(benchReport)
    .innerJoin(reporter, eq(reporter.userId, benchReport.userId))
    .innerJoin(reported, eq(reported.userId, benchReport.reportedUserId))
    .leftJoin(benchMessage, eq(benchMessage.messageId, benchReport.messageId))
    .leftJoin(benchChannel, eq(benchChannel.channelId, benchMessage.channelId))
    .where(state === "open" ? eq(benchReport.status, "open") : ne(benchReport.status, "open"))
    .orderBy(desc(benchReport.createdAt))
    .limit(100);

  const ids = reports.map((r) => r.id);
  const actions = ids.length === 0 ? [] : await db
    .select({ reportId: benchReportAction.reportId, action: benchReportAction.action, note: benchReportAction.note, userName: user.userName, createdAt: benchReportAction.createdAt })
    .from(benchReportAction)
    .leftJoin(user, eq(user.userId, benchReportAction.userId))
    .where(inArray(benchReportAction.reportId, ids))
    .orderBy(benchReportAction.createdAt);

  return reports.map(({ deletedInd, ...r }) => ({
    ...r,
    // A message report always kept its words; the message is gone when hidden, deleted by its author, or removed outright.
    messageGone: r.messageBody !== null && deletedInd !== false,
    actions: actions.filter((a) => a.reportId === r.id).map(({ reportId: _, userName, ...a }) => ({ ...a, userName: userName ?? "Chef" })),
  }));
}

export type ReportAction = "hide" | "dismiss" | "resolve";
const CLOSED_AS = { hide: "hidden", dismiss: "dismissed", resolve: "resolved" } as const;

/**
 * Closes an open report. `hide` also hides its message from everyone (kept on record, as a deletion is) and closes every other
 * open report about that message. `resolve` needs a note.
 */
export async function actOnReport(reportId: string, moderatorId: number, action: ReportAction, note?: string): Promise<void> {
  if (action === "resolve" && !note) throw new AppError(400, "VALIDATION", "Say how the report was resolved");
  const hidden = await db.transaction(async (tx) => {
    const [report] = await tx
      .select({ status: benchReport.status, messageId: benchReport.messageId })
      .from(benchReport)
      .where(eq(benchReport.id, reportId))
      .for("update");
    if (!report) throw new AppError(404, "NOT_FOUND", "Report not found");
    if (report.status !== "open") throw new AppError(409, "INVALID_STATE", "This report is already closed");

    let closing = [reportId];
    if (action === "hide") {
      if (!report.messageId) throw new AppError(409, "INVALID_STATE", "This report is about a person, not a message");
      await tx.update(benchMessage).set({ deletedInd: true, updatedDttm: new Date() }).where(eq(benchMessage.messageId, report.messageId));
      const others = await tx
        .select({ id: benchReport.id })
        .from(benchReport)
        .where(and(eq(benchReport.messageId, report.messageId), eq(benchReport.status, "open")))
        .for("update");
      closing = others.map((r) => r.id);
    }
    await tx.update(benchReport).set({ status: CLOSED_AS[action], updatedAt: new Date() }).where(inArray(benchReport.id, closing));
    await tx.insert(benchReportAction).values(closing.map((id) => ({ reportId: id, userId: moderatorId, action, note: note || null })));
    return action === "hide" ? report.messageId : null;
  });
  if (hidden) await announceHidden(hidden);
}
