/**
 * @module services/benchBlockService
 *
 * Blocking on The Bench. A person who blocks another stops receiving that person's messages, reactions, typing and presence
 * (history here, live delivery in benchSocketService), and neither can message the other. The blocked person is not told.
 */

import pino from "pino";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { benchBlock, user } from "../db/schema.js";
import { AppError } from "../utils/appError.js";

const logger = pino({ name: "benchBlockService" });

/**
 * Before migration 0009 is applied there is no table: the Bench goes on with nobody blocked, rather than failing every read.
 * shortcut: checked on every read, drop once 0009 is applied everywhere.
 */
async function orNone<T>(read: () => Promise<T>, none: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err;
    logger.warn("Bench: bench_blocks is missing (migration 0009 not applied); nobody is treated as blocked");
    return none;
  }
}

/** The people this person has blocked. */
export async function blockedBy(userId: number): Promise<number[]> {
  return orNone(async () => {
    const rows = await db.select({ id: benchBlock.blockedUserId }).from(benchBlock).where(eq(benchBlock.userId, userId));
    return rows.map((r) => r.id);
  }, []);
}

/** Has either of the two blocked the other? */
export async function isBlockedEitherWay(a: number, b: number): Promise<boolean> {
  return orNone(async () => {
    const rows = await db
      .select({ id: benchBlock.id })
      .from(benchBlock)
      .where(or(and(eq(benchBlock.userId, a), eq(benchBlock.blockedUserId, b)), and(eq(benchBlock.userId, b), eq(benchBlock.blockedUserId, a))))
      .limit(1);
    return rows.length > 0;
  }, false);
}

/**
 * Can this person come across the other on the Bench: a shared organisation, a direct-message thread, or a message of theirs in a
 * channel this person may read? Only such a person can be blocked or reported, so neither tells anyone who exists behind an id.
 */
export async function canMeet(viewerId: number, otherId: number): Promise<boolean> {
  const [row] = (await db.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM user_organisation mine JOIN user_organisation theirs ON theirs.organisation_id = mine.organisation_id
              WHERE mine.user_id = ${viewerId} AND theirs.user_id = ${otherId})
      OR EXISTS (SELECT 1 FROM bench_dm_thread WHERE user_a_id = ${Math.min(viewerId, otherId)} AND user_b_id = ${Math.max(viewerId, otherId)})
      OR EXISTS (SELECT 1 FROM bench_message m JOIN bench_channel c ON c.channel_id = m.channel_id
                 WHERE m.user_id = ${otherId} AND m.deleted_ind = false
                   AND (c.channel_type = 'global' OR c.organisation_id IN (SELECT organisation_id FROM user_organisation WHERE user_id = ${viewerId})))
      AS met`)) as unknown as Array<{ met: boolean }>;
  return row?.met === true;
}

/** Blocks a person; blocking again changes nothing. 404 for anyone this person cannot come across, as for nobody. */
export async function blockPerson(userId: number, otherId: number): Promise<void> {
  if (otherId === userId) throw new AppError(400, "VALIDATION", "You cannot block yourself");
  if (!(await canMeet(userId, otherId))) throw new AppError(404, "NOT_FOUND", "Person not found");
  await db.insert(benchBlock).values({ userId, blockedUserId: otherId }).onConflictDoNothing();
}

/** Unblocks; someone who was not blocked is a success too. */
export async function unblockPerson(userId: number, otherId: number): Promise<void> {
  await db.delete(benchBlock).where(and(eq(benchBlock.userId, userId), eq(benchBlock.blockedUserId, otherId)));
}

/** The people this person blocked, newest first, with what they need to recognise them. */
export async function listBlocked(userId: number) {
  return db
    .select({ userId: user.userId, userName: user.userName, userPhotoPath: user.userPhotoPath })
    .from(benchBlock)
    .innerJoin(user, eq(user.userId, benchBlock.blockedUserId))
    .where(eq(benchBlock.userId, userId))
    .orderBy(sql`${benchBlock.createdAt} DESC`);
}
