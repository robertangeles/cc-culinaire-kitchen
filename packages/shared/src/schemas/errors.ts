import { z } from "zod";

/**
 * The error body the server sends: always `error` (a sentence for people), and, on routes the phone calls,
 * a machine-readable `code`. The phone branches on `code` and shows `error` only as detail. Some older
 * routes send `error` as an object or send no `code`, so both are optional and parsed leniently.
 */
export const ApiErrorBodySchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() }).transform((e) => e.message)]).optional().catch(undefined),
  code: z.string().optional().catch(undefined),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

/** Codes are compared in one spelling: the server has both `upgrade_required` and `INVALID_CREDENTIALS` today. */
export const normaliseCode = (code: string) => code.trim().toUpperCase();
