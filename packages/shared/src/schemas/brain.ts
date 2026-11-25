import { z } from "zod";

/** One row of `GET /api/brain/memories`. `canManage` is the server's say on this row; anything but a plain `true` reads as no. */
export const MemorySchema = z.object({
  memoryId: z.string(),
  title: z.string().nullable().catch(null),
  body: z.string(),
  sourceType: z.string().catch(""),
  /** "user" is private to the viewer, "org" is shared with their kitchen. */
  scope: z.enum(["user", "org"]).catch("user"),
  isPinned: z.boolean().catch(false),
  /** "pending" and "processing" are still being learned. */
  status: z.string().catch("ready"),
  createdDttm: z.string().catch(""),
  canManage: z.boolean().catch(false),
  /** Who shared it; null on the viewer's own rows. */
  authorName: z.string().nullable().catch(null),
});
export type Memory = z.infer<typeof MemorySchema>;

/** A row this app cannot read is left out rather than failing the whole list. */
export const MemoryListSchema = z
  .array(z.unknown())
  .transform((rows) => rows.flatMap((r) => {
    const parsed = MemorySchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  }));

export const MemoryPageSchema = z.object({ memories: MemoryListSchema, total: z.number().int().nonnegative().catch(0) });
export type MemoryPage = z.infer<typeof MemoryPageSchema>;

/** `GET|PUT /api/brain/nudges/opt-in`. */
export const NudgeOptInSchema = z.object({ optIn: z.boolean() });
