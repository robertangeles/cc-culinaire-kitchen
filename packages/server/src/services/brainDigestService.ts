/**
 * @module services/brainDigestService
 *
 * Weekly "what your kitchen's Brain learned" org digest (spec T15). For each org
 * that captured shared memories in the past 7 days, builds a plain-English
 * summary and delivers an in-app notification to that org's admins.
 *
 * Deterministic template — NO LLM (spec T15, matching the T12 ops-capture call,
 * lessons #60): the counts are structured data we already hold, so a template is
 * free, instant, testable, and carries no prompt-injection surface. An LLM prose
 * pass can be added later behind a flag if the plain version feels dry.
 *
 * Runs Sunday 8 PM via the scheduler in index.ts, guarded by `withAdvisoryLock`
 * so only one app instance sends.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import pino from "pino";
import { db } from "../db/index.js";
import { userOrganisation } from "../db/schema.js";
import { getAllSettings } from "./settingsService.js";
import { createInApp } from "./notificationService.js";

const logger = pino({ name: "brainDigest" });

/** Kitchen-native source labels (mirrors the Your-Brain provenance copy). */
const SOURCE_LABELS: Record<string, string> = {
  chat: "chat",
  recipe: "recipes",
  purchase_order: "purchasing",
  waste: "the waste log",
  stock: "the stock room",
  menu: "the menu",
  prep: "prep",
};

/** Per-org rollup of the week's shared memories. */
interface OrgStat {
  total: number;
  bySource: Map<string, number>;
}

/**
 * Build the plain-English digest body for one org (deterministic — spec T15).
 * Exported for unit testing the template in isolation.
 */
export function buildDigestBody(stat: OrgStat): string {
  const parts = [...stat.bySource.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, n]) => `${n} from ${SOURCE_LABELS[source] ?? source}`);
  const thing = stat.total === 1 ? "thing" : "things";
  return `This week your kitchen's Brain learned ${stat.total} new ${thing}: ${parts.join(", ")}.`;
}

/**
 * Send the weekly Brain digest to every org that learned something this week.
 * Zero-memory orgs are skipped (they never appear in the grouped query). Gated
 * by the `brain_enabled` master flag. Delivery failures are logged per-org and
 * never abort the run.
 */
export async function sendOrgDigests(): Promise<void> {
  const settings = await getAllSettings();
  if (settings.brain_enabled === "false") {
    logger.info("Brain disabled — skipping org digest");
    return;
  }

  // Per-(org, source) counts over the last 7 days — one grouped query, no N+1.
  // scope='org' rows with a set organisation_id; zero-memory orgs are simply absent.
  const rows = (await db.execute(sql`
    SELECT organisation_id, source_type, count(*)::int AS n
    FROM brain_memory
    WHERE scope = 'org' AND organisation_id IS NOT NULL
      AND created_dttm > now() - interval '7 days'
    GROUP BY organisation_id, source_type
  `)) as unknown as Array<{ organisation_id: number; source_type: string; n: number }>;

  if (rows.length === 0) {
    logger.info("No org memories this week — no digests to send");
    return;
  }

  // Roll up per org.
  const perOrg = new Map<number, OrgStat>();
  for (const r of rows) {
    const stat = perOrg.get(r.organisation_id) ?? { total: 0, bySource: new Map() };
    stat.total += r.n;
    stat.bySource.set(r.source_type, r.n);
    perOrg.set(r.organisation_id, stat);
  }

  // Admins of the digesting orgs — one query, delivered per org.
  const orgIds = [...perOrg.keys()];
  const admins = await db
    .select({ userId: userOrganisation.userId, organisationId: userOrganisation.organisationId })
    .from(userOrganisation)
    .where(and(inArray(userOrganisation.organisationId, orgIds), eq(userOrganisation.role, "admin")));

  let delivered = 0;
  for (const admin of admins) {
    const stat = perOrg.get(admin.organisationId);
    if (!stat) continue;
    try {
      await createInApp({
        organisationId: admin.organisationId,
        recipientUserId: admin.userId,
        type: "BRAIN_DIGEST",
        payload: { summary: buildDigestBody(stat), total: stat.total },
      });
      delivered++;
    } catch (err) {
      logger.error({ err, organisationId: admin.organisationId }, "Brain digest delivery failed");
    }
  }

  logger.info({ orgs: perOrg.size, delivered }, "Brain org digests sent");
}
