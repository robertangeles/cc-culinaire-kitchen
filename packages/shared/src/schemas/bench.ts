import { z } from "zod";

/** A list whose unreadable rows are left out rather than failing the whole list. */
const rows = <T extends z.ZodTypeAny>(row: T) =>
  z.array(z.unknown()).transform((all) => all.flatMap((r): z.output<T>[] => {
    const parsed = row.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  }));

/** `GET /api/bench/channels`. "everyone" is the global one; each kitchen the person belongs to has one of its own. */
export const BenchChannelSchema = z.object({
  channelId: z.number(),
  /** The room's name on the live channel: "everyone" or "org_<id>". */
  channelKey: z.string(),
  channelName: z.string().catch(""),
  channelType: z.enum(["global", "organisation"]),
  channelBanner: z.string().nullable().catch(null).default(null),
});
export type BenchChannel = z.infer<typeof BenchChannelSchema>;
export const BenchChannelListSchema = rows(BenchChannelSchema);

const ReactionSchema = z.object({ emoji: z.string(), userIds: z.array(z.number()) });
export type BenchReaction = z.infer<typeof ReactionSchema>;
export const ReactionListSchema = rows(ReactionSchema);

/** A message in a channel or a direct message, from a list or the live channel. It belongs to exactly the room it names. */
export const BenchMessageSchema = z
  .object({
    messageId: z.string(),
    channelId: z.number().nullable().default(null),
    dmThreadId: z.number().nullable().default(null),
    userId: z.number(),
    userName: z.string().catch("Chef"),
    userPhotoPath: z.string().nullable().catch(null),
    messageBody: z.string().catch(""),
    messageType: z.string().catch("text").default("text"),
    recipeTitle: z.string().nullable().catch(null).default(null),
    editedInd: z.boolean().catch(false),
    createdDttm: z.string(),
    reactions: ReactionListSchema.catch([]).default([]),
  })
  .refine((m) => m.channelId !== null || m.dmThreadId !== null);
export type BenchMessage = z.infer<typeof BenchMessageSchema>;

/**
 * `messageId` of a post (`bench:message`, `bench:dm:send`), made by the client: the same post again under it answers the first one (a deleted one
 * with `bench:message:deleted`), anything else under it is refused with `CONFLICT`. Older apps send none.
 */
export const BenchPostIdSchema = z.string().uuid().optional();

/** `GET /api/bench/channels/:key/messages` and `GET /api/bench/dm/threads/:id/messages`, oldest first. */
export const BenchMessagePageSchema = z.object({ messages: rows(BenchMessageSchema) }).transform((p) => p.messages);

/** `GET /api/bench/dm/threads`. */
export const DmThreadSchema = z.object({
  dmThreadId: z.number(),
  otherUserId: z.number(),
  otherUserName: z.string().catch("Chef"),
  otherUserPhotoPath: z.string().nullable().catch(null),
  lastMessage: z.string().nullable().catch(null).default(null),
  lastMessageAt: z.string().catch("").default(""),
});
export type DmThread = z.infer<typeof DmThreadSchema>;
export const DmThreadListSchema = rows(DmThreadSchema);

/** `POST /api/bench/dm/threads`: the thread, with the other person's name and picture (not their id, which the phone sent). */
export const OpenedThreadSchema = z.object({ dmThreadId: z.number(), otherUserName: z.string().catch("Chef"), otherUserPhotoPath: z.string().nullable().catch(null) });

/** `GET /api/bench/channels/:key/pins`. A pin whose message is gone has no body and is left out. */
export const PinListSchema = rows(z.object({ messageId: z.string(), messageBody: z.string(), userName: z.string().catch("Chef") }));
export type BenchPin = z.output<typeof PinListSchema>[number];

/** `GET /api/bench/channels/:key/search`. */
export const SearchListSchema = rows(z.object({ messageId: z.string(), messageBody: z.string(), userName: z.string().catch("Chef"), createdDttm: z.string().catch("") }));
export type BenchSearchHit = z.output<typeof SearchListSchema>[number];

export const BenchPersonSchema = z.object({ userId: z.number(), userName: z.string().catch("Chef"), userPhotoPath: z.string().nullable().catch(null) });
export type BenchPerson = z.infer<typeof BenchPersonSchema>;

/** The live channel's `bench:presence:update`: who is in that room now. */
export const PresenceSchema = z.object({ channelKey: z.string(), users: rows(BenchPersonSchema) });

/** `GET /api/bench/blocks`: the people this person has blocked. */
export const BlockedListSchema = rows(BenchPersonSchema);

/** Why a message or a person is reported. */
export const BENCH_REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "other"] as const;
export type BenchReportReason = (typeof BENCH_REPORT_REASONS)[number];
export const BENCH_REPORT_REASON_LABELS: Record<BenchReportReason, string> = {
  spam: "Spam or advertising",
  harassment: "Harassment or bullying",
  hate: "Hate or discrimination",
  sexual: "Sexual content",
  violence: "Violence or threats",
  other: "Something else",
};

/** `POST /api/bench/reports`: a message (`messageId`) or a person (`userId`), not both. 201 `{ id }`; 429 `RATE_LIMITED` past the daily limit. */
export const BenchReportRequestSchema = z
  .object({
    messageId: z.string().uuid().optional(),
    userId: z.number().int().positive().max(2_147_483_647).optional(),
    reason: z.enum(BENCH_REPORT_REASONS),
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => (r.messageId === undefined) !== (r.userId === undefined), { message: "Report a message or a person" });
export type BenchReportRequest = z.infer<typeof BenchReportRequestSchema>;

export const BENCH_REPORT_STATUSES = ["open", "hidden", "dismissed", "resolved"] as const;

/** `GET /api/bench/reports` (moderators): a report, what it was about as it was then, and what was done about it. */
export const BenchReportSchema = z.object({
  id: z.string(),
  status: z.enum(BENCH_REPORT_STATUSES),
  reason: z.enum(BENCH_REPORT_REASONS).catch("other"),
  note: z.string().nullable().catch(null),
  createdAt: z.string(),
  reporterName: z.string().catch("Chef"),
  reportedUserId: z.number(),
  reportedUserName: z.string().catch("Chef"),
  messageId: z.string().nullable().catch(null),
  messageBody: z.string().nullable().catch(null),
  /** Hidden by a moderator, or deleted by its author, since. */
  messageGone: z.boolean().catch(false),
  /** The channel's name; null for a direct message or a person. */
  channelName: z.string().nullable().catch(null),
  actions: rows(z.object({ action: z.enum(["hide", "dismiss", "resolve"]), note: z.string().nullable().catch(null), userName: z.string().catch("Chef"), createdAt: z.string() })).catch([]),
});
export type BenchReport = z.infer<typeof BenchReportSchema>;
export const BenchReportListSchema = rows(BenchReportSchema);
