import { z } from "zod";
import { numeric } from "./lenient.js";

/** The task states the server accepts on `PATCH /api/prep/tasks/:id`. The phone sets the three a cook sets by hand (`in_progress` exists, no screen uses it). */
export const PREP_STATUSES = ["pending", "completed", "skipped"] as const;

/** `priorityTier` in the order a cook works them. */
export const PREP_TIERS = ["start_first", "then_these", "can_wait"] as const;

const idNumber = z.number().nullable().catch(null);

/** A prep task as the server returns it. An unknown status or tier falls back, so a new one never hides the list. */
export const PrepTaskSchema = z.object({
  prepTaskId: z.string(),
  prepSessionId: z.string(),
  taskDescription: z.string().catch(""),
  ingredientName: z.string(),
  quantityNeeded: numeric.catch(0),
  unit: z.string().catch(""),
  prepTimeMinutes: z.number().nullable().catch(null),
  priorityTier: z.string().catch("then_these"),
  station: z.string().nullable().catch(null),
  onHandQty: numeric.nullable().catch(null),
  prepNeeded: numeric.nullable().catch(null),
  status: z.string().catch("pending"),
  assignedTo: z.string().nullable().catch(null),
  completedAt: z.string().nullable().catch(null),
  /** The user id of whoever ticked it (the server sends no name). */
  completedBy: idNumber,
});
export type PrepTask = z.infer<typeof PrepTaskSchema>;

export const PrepSessionSchema = z.object({
  prepSessionId: z.string(),
  userId: z.number().catch(0),
  prepDate: z.string(),
  expectedCovers: z.number().nullable().catch(null),
  actualCovers: z.number().nullable().catch(null),
  tasksTotal: z.number().catch(0),
  tasksCompleted: z.number().catch(0),
  tasksSkipped: z.number().catch(0),
  isEnded: z.boolean().catch(false),
});
export type PrepSession = z.infer<typeof PrepSessionSchema>;

/** `GET /api/prep/sessions/today` and `GET /api/prep/sessions/:id`. A task this version cannot read is skipped, never the whole list. */
export const PrepTodaySchema = z.object({
  session: PrepSessionSchema,
  tasks: z.array(z.unknown()).catch([]).transform((rows) => rows.flatMap((r) => { const p = PrepTaskSchema.safeParse(r); return p.success ? [p.data] : []; })),
});
export type PrepToday = z.infer<typeof PrepTodaySchema>;

/** `GET /api/prep/menu`: what a cook can pick to prep. The phone reads names, categories and ids only. */
export const PrepMenuSchema = z.object({
  menuItems: z.array(z.unknown()).catch([]).transform((rows) => rows.flatMap((r) => { const p = z.object({ menuItemId: z.string(), name: z.string(), category: z.string().nullable().catch(null) }).safeParse(r); return p.success ? [p.data] : []; })),
  recipes: z.array(z.unknown()).catch([]).transform((rows) => rows.flatMap((r) => { const p = z.object({ recipeId: z.string(), title: z.string() }).safeParse(r); return p.success ? [p.data] : []; })),
});
export type PrepMenu = z.infer<typeof PrepMenuSchema>;

/** One dish in a saved selection (`GET /api/prep/previous-selections` is a bare array of these). */
const PrepSelectionRowSchema = z.object({
  menuItemId: z.string().nullable().catch(null),
  recipeId: z.string().nullable().catch(null),
  dishName: z.string(),
  expectedPortions: z.number().catch(1),
  category: z.string().nullable().catch(null),
});
export const PrepSelectionsSchema = z.array(z.unknown()).catch([]).transform((rows) => rows.flatMap((r) => { const p = PrepSelectionRowSchema.safeParse(r); return p.success ? [p.data] : []; }));
export type PrepSelection = z.infer<typeof PrepSelectionRowSchema>;

/** The dish the phone sends in `POST /api/prep/sessions/:id/selections` (the server's own schema). */
export interface PrepSelectionInput {
  menuItemId?: string;
  recipeId?: string;
  dishName: string;
  expectedPortions: number;
  category?: string;
}
