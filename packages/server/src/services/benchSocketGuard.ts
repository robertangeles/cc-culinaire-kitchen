/**
 * @module services/benchSocketGuard
 *
 * Every Bench socket event goes through {@link onBenchEvent}: a payload of the wrong shape never
 * reaches the handler, and an error in a handler is logged with its context.
 */

import type { Socket } from "socket.io";
import pino from "pino";
import { z } from "zod";

const logger = pino({ name: "benchSocket" });

const PG_INT_MAX = 2_147_483_647;

const id = z
  .union([z.number(), z.string().regex(/^\d{1,10}$/).transform(Number)])
  .pipe(z.number().int().positive().max(PG_INT_MAX));

/** A room or channel name; the number in org_<id> and dm_<id> must be one the database can hold. */
const channelKey = z
  .string()
  .max(50)
  .regex(/^[a-z0-9_]+$/)
  .refine((key) => (key.match(/\d+/g) ?? []).every((digits) => Number(digits) <= PG_INT_MAX));

const messageId = z.string().uuid();
const reaction = z.object({ messageId, emoji: z.string().min(1).max(20) });

/** Length limits on message text stay in the handlers: they answer the sender. */
const schemas = {
  "bench:join": z.object({ channelKey }),
  "bench:leave": z.object({ channelKey }),
  "bench:message": z.object({
    channelKey,
    body: z.string(),
    messageType: z.enum(["text", "recipe_share"]).nullish(),
    recipeId: z.string().uuid().nullish(),
  }),
  "bench:typing": z.object({ channelKey }),
  "bench:reaction:add": reaction,
  "bench:reaction:remove": reaction,
  "bench:message:delete": z.object({ messageId }),
  "bench:message:edit": z.object({ messageId, newBody: z.string() }),
  "bench:dm:send": z.object({ recipientId: id, body: z.string() }),
  "bench:dm:typing": z.object({ recipientId: id }),
  "bench:presence:heartbeat": z.unknown(),
  disconnect: z.unknown(),
} satisfies Record<string, z.ZodTypeAny>;

type BenchEvent = keyof typeof schemas;

export function onBenchEvent<E extends BenchEvent>(
  socket: Socket,
  event: E,
  handler: (data: z.output<(typeof schemas)[E]>) => unknown,
): void {
  socket.on(event as string, async (payload: unknown) => {
    const context = { event, userId: socket.data.user.sub, socketId: socket.id };
    try {
      const parsed = schemas[event].safeParse(payload);
      if (!parsed.success) {
        // Field names only: the payload can hold a private message.
        logger.warn({ ...context, fields: parsed.error.issues.map((i) => i.path.join(".")) }, "Bench: malformed event dropped");
        socket.emit("bench:error", { error: "Invalid request", code: "VALIDATION" });
        return;
      }
      await handler(parsed.data);
    } catch (err) {
      logger.error({ ...context, err }, "Bench: event handler failed");
    }
  });
}
