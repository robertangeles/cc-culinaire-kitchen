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

/** A link the phone will open: https only, so a server setting can never send the app to another kind of address. */
const storeUrl = z.string().url().refine((u) => u.startsWith("https://")).optional().catch(undefined);

/**
 * The 426 body (`upgrade_required`): the lowest allowed version and, once the owner has set a listing, where to get the update.
 * Every field falls back, because a build too old to sign in must still reach its update screen.
 */
export const UpgradeRequiredBodySchema = z
  .object({
    minVersion: z.string().catch(""),
    storeUrls: z.object({ ios: storeUrl, android: storeUrl }).optional().catch(undefined),
  })
  .catch({ minVersion: "", storeUrls: undefined });
export type UpgradeRequired = z.infer<typeof UpgradeRequiredBodySchema>;
