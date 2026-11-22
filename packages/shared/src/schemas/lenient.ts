/**
 * Rules for every phone-facing schema, so an installed app survives a server that moved on without it:
 * unknown fields are ignored (zod strips them), unknown enum values fall back to a safe value with `.catch`,
 * and only the fields a screen cannot work without are required. Add new schemas as their own file in this
 * folder; each is reachable as `@culinaire/shared/schemas/<file>`, so no shared index needs editing.
 */
import { z } from "zod";

/** Postgres numeric columns arrive as strings ("12.500"); the phone wants numbers. Anything else becomes NaN, which `.finite()` rejects. */
export const numeric = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite());
