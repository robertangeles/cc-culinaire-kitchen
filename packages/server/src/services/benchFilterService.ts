/**
 * @module services/benchFilterService
 *
 * The Bench's word filter: a post or an edit that contains a listed word or phrase is refused before it is stored or sent to anyone.
 * The list is not in the repository, which is public: the owner keeps it in `site_setting` under {@link BLOCKED_TERMS_KEY}, one term per line.
 * It is read again at most a minute after it was last read. An empty or missing list filters nothing.
 */

import pino from "pino";
import { eq } from "drizzle-orm";
import { BENCH_POST_REFUSED, compileBlockedTerms, countBlockedTerms, type BlockedTerms } from "@culinaire/shared";
import { db } from "../db/index.js";
import { siteSetting } from "../db/schema.js";
import { AppError } from "../utils/appError.js";

const logger = pino({ name: "benchFilter" });

export const BLOCKED_TERMS_KEY = "bench.blocked_terms";
const CACHE_MS = 60_000;

let cached: { terms: BlockedTerms; readAt: number } | null = null;
let reading: Promise<BlockedTerms> | null = null;

async function readTerms(): Promise<BlockedTerms> {
  const [row] = await db
    .select({ value: siteSetting.settingValue })
    .from(siteSetting)
    .where(eq(siteSetting.settingKey, BLOCKED_TERMS_KEY))
    .limit(1);
  const terms = compileBlockedTerms(row?.value ?? "");
  // The terms themselves are never logged, only how many there are.
  if (terms.length === 0) logger.warn(`Bench: ${BLOCKED_TERMS_KEY} is empty, so no post is filtered`);
  else logger.info({ count: terms.length }, "Bench: blocked terms read");
  cached = { terms, readAt: Date.now() };
  return terms;
}

/** The list, read again when it is a minute old. One read at a time. */
export function blockedTerms(): Promise<BlockedTerms> {
  if (cached && Date.now() - cached.readAt < CACHE_MS) return Promise.resolve(cached.terms);
  return (reading ??= readTerms().finally(() => void (reading = null)));
}

/** Throws a 422 POST_NOT_ALLOWED when the text contains a listed term. Neither the text nor the term is logged. */
export async function refuseBlockedTerms(text: string): Promise<void> {
  const matched = countBlockedTerms(text, await blockedTerms());
  if (matched === 0) return;
  logger.info({ matched }, "Bench: post refused by the word filter");
  throw new AppError(422, "POST_NOT_ALLOWED", BENCH_POST_REFUSED);
}

export const __test = { reset: () => void ((cached = null), (reading = null)) };
