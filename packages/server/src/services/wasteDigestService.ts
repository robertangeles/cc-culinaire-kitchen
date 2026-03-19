/**
 * @module services/wasteDigestService
 *
 * Weekly waste email digest. Sends a summary of each user's waste data
 * for the past 7 days, compared against the previous week, with a
 * practical AI reuse tip for their top waste item.
 *
 * Designed to run every Sunday at 8 PM via the cron scheduler in index.ts.
 */

import pino from "pino";
import { Resend } from "resend";
import { db } from "../db/index.js";
import { wasteLog, user } from "../db/schema.js";
import { sql, gte, lte } from "drizzle-orm";
import { getWasteSummary, type WasteSummary } from "./wasteService.js";
import { getAllSettings } from "./settingsService.js";
import { decryptUserPii } from "./piiService.js";

const logger = pino({ name: "wasteDigest" });

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@culinaire.kitchen";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Send weekly waste digest emails to all users who logged waste in
 * the past 7 days. Checks `waste_digest_enabled` site setting first.
 */
export async function sendWeeklyWasteDigests(): Promise<void> {
  // 1. Check site setting
  const settings = await getAllSettings();
  if (settings.waste_digest_enabled === "false") {
    logger.info("Waste digest disabled via site setting — skipping");
    return;
  }

  // 2. Resolve Resend API key
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    logger.warn("RESEND_API_KEY not set — waste digest emails skipped");
    return;
  }
  const resend = new Resend(resendKey);

  // 3. Calculate date ranges
  const now = new Date();
  const thisWeekEnd = new Date(now);
  thisWeekEnd.setHours(23, 59, 59, 999);

  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(thisWeekStart.getDate() - 6);
  thisWeekStart.setHours(0, 0, 0, 0);

  const prevWeekEnd = new Date(thisWeekStart);
  prevWeekEnd.setMilliseconds(-1);

  const prevWeekStart = new Date(prevWeekEnd);
  prevWeekStart.setDate(prevWeekStart.getDate() - 6);
  prevWeekStart.setHours(0, 0, 0, 0);

  // 4. Find distinct users with waste data in the past 7 days
  const usersWithWaste = await db
    .selectDistinct({ userId: wasteLog.userId })
    .from(wasteLog)
    .where(
      sql`${wasteLog.loggedAt} >= ${thisWeekStart} AND ${wasteLog.loggedAt} <= ${thisWeekEnd}`,
    );

  if (usersWithWaste.length === 0) {
    logger.info("No users with waste data this week — no digests to send");
    return;
  }

  logger.info({ userCount: usersWithWaste.length }, "Preparing weekly waste digests");

  let sent = 0;
  let failed = 0;

  for (const { userId } of usersWithWaste) {
    try {
      // 4a. Get user email (decrypt PII)
      const [userRow] = await db.select().from(user).where(sql`${user.userId} = ${userId}`);
      if (!userRow) continue;

      const pii = decryptUserPii(userRow as unknown as Record<string, unknown>);
      const email = pii.userEmail;
      const name = pii.userName;

      if (!email) continue;

      // 4b. Get this week and previous week summaries
      const [thisWeek, prevWeek] = await Promise.all([
        getWasteSummary(userId, thisWeekStart.toISOString(), thisWeekEnd.toISOString()),
        getWasteSummary(userId, prevWeekStart.toISOString(), prevWeekEnd.toISOString()),
      ]);

      // Skip if nothing was wasted (safety check)
      if (thisWeek.totalEntries === 0) continue;

      // 4c. Calculate trend
      const trend = calculateTrend(thisWeek.totalCost, prevWeek.totalCost);

      // 4d. Generate reuse tip from top waste item
      const topItem = thisWeek.topByCost[0];
      const reuseTip = topItem ? generateReuseTip(topItem.name) : null;

      // 4e. Build and send email
      const html = buildDigestHtml({
        name,
        startDate: thisWeekStart,
        endDate: thisWeekEnd,
        thisWeek,
        trend,
        reuseTip,
      });

      const dateRange = formatDateRange(thisWeekStart, thisWeekEnd);

      const { error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `Your Weekly Waste Report — ${dateRange}`,
        html,
      });

      if (error) {
        logger.error({ error, userId, email }, "Failed to send waste digest");
        failed++;
      } else {
        sent++;
      }
    } catch (err) {
      logger.error({ err, userId }, "Error processing waste digest for user");
      failed++;
    }
  }

  logger.info({ sent, failed }, "Weekly waste digest run complete");
}

// ---------------------------------------------------------------------------
// Trend calculation
// ---------------------------------------------------------------------------

interface Trend {
  direction: "up" | "down" | "flat";
  percentage: number;
  label: string;
  color: string;
}

function calculateTrend(currentCost: number, previousCost: number): Trend {
  if (previousCost === 0 && currentCost === 0) {
    return { direction: "flat", percentage: 0, label: "No change", color: "#78716c" };
  }
  if (previousCost === 0) {
    return { direction: "up", percentage: 100, label: "New this week", color: "#78716c" };
  }

  const change = ((currentCost - previousCost) / previousCost) * 100;
  const absChange = Math.abs(Math.round(change));

  if (absChange < 2) {
    return { direction: "flat", percentage: 0, label: "About the same as last week", color: "#78716c" };
  }
  if (change < 0) {
    return { direction: "down", percentage: absChange, label: `↓ ${absChange}% less than last week`, color: "#16a34a" };
  }
  return { direction: "up", percentage: absChange, label: `↑ ${absChange}% more than last week`, color: "#dc2626" };
}

// ---------------------------------------------------------------------------
// Reuse tip (deterministic, no AI call to keep the digest fast/free)
// ---------------------------------------------------------------------------

const REUSE_TIPS: Record<string, string> = {
  default:
    "Consider repurposing trims and off-cuts into stocks, sauces, or staff meals. A well-run kitchen wastes nothing.",
};

const INGREDIENT_TIPS: [RegExp, string][] = [
  [/herb|cilantro|parsley|basil|dill|mint|chive/i,
    "Blend soft herb trims into compound butters, chimichurri, or herb oils. Freeze in ice cube trays for instant flavour hits."],
  [/onion|shallot|leek|scallion/i,
    "Caramelise onion trims low and slow into onion jam, or add skins to your stock pot for colour and depth."],
  [/carrot|celery|mirepoix/i,
    "Classic mirepoix trims are stock gold. Freeze in labelled bags until you have enough for a batch."],
  [/tomato/i,
    "Roast tomato trims with garlic and olive oil for a quick coulis, or dehydrate for umami-rich tomato powder."],
  [/bread|baguette|roll|croissant/i,
    "Stale bread becomes croutons, breadcrumbs, panzanella, or bread pudding. Never waste bread."],
  [/chicken|poultry/i,
    "Chicken bones and trim make excellent stock. Roast first for a richer fond. Freeze carcasses until stock day."],
  [/beef|veal|lamb/i,
    "Red meat trims can be ground for staff meal burgers, or braised into ragu. Bones make incredible demi-glace."],
  [/fish|salmon|tuna|cod/i,
    "Fish bones and heads make fumet in 20 minutes. Skin can be fried crispy for a garnish."],
  [/potato/i,
    "Potato peelings fry up into addictive chips. Overcooked potatoes become gnocchi or thickener for soups."],
  [/citrus|lemon|lime|orange/i,
    "Zest before juicing — freeze zest for baking. Spent halves clean cutting boards. Peels make oleo saccharum for cocktails."],
  [/cream|milk|dairy/i,
    "Cream nearing its date makes excellent panna cotta, ice cream base, or enriched mash. Culture it into creme fraiche."],
  [/rice|grain|quinoa/i,
    "Day-old rice is ideal for fried rice — it's drier and won't clump. Grains reheat well in soups and grain bowls."],
  [/mushroom/i,
    "Dehydrate mushroom stems and trims, then grind into mushroom powder — pure umami for sauces and rubs."],
  [/avocado/i,
    "Browning avocado works fine blended into smoothies, dressings, or frozen for future guacamole."],
  [/egg/i,
    "Egg whites freeze perfectly for meringues and cocktails. Yolks make aioli, custards, or cure into cured egg yolks."],
  [/cheese/i,
    "Hard cheese rinds enrich soups and risottos. Soft cheese trims melt into sauces or baked dips."],
];

function generateReuseTip(ingredientName: string): string {
  for (const [pattern, tip] of INGREDIENT_TIPS) {
    if (pattern.test(ingredientName)) return tip;
  }
  return REUSE_TIPS.default;
}

// ---------------------------------------------------------------------------
// HTML email builder
// ---------------------------------------------------------------------------

interface DigestData {
  name: string;
  startDate: Date;
  endDate: Date;
  thisWeek: WasteSummary;
  trend: Trend;
  reuseTip: string | null;
}

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = end.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function buildDigestHtml(data: DigestData): string {
  const { name, startDate, endDate, thisWeek, trend, reuseTip } = data;
  const dateRange = formatDateRange(startDate, endDate);

  // Top 3 items table
  const topItems = thisWeek.topByCost.slice(0, 3);
  const topItemsRows = topItems.length > 0
    ? topItems
        .map(
          (item, i) => {
            const weight = thisWeek.topByWeight.find((w) => w.name === item.name);
            return `
            <tr>
              <td style="padding:10px 12px;border-bottom:1px solid #2a2a2a;color:#e5e5e5;font-size:14px;">${i + 1}. ${escapeHtml(item.name)}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #2a2a2a;color:#a3a3a3;font-size:14px;text-align:right;">${weight ? `${weight.weight.toFixed(1)} ${weight.unit}` : "—"}</td>
              <td style="padding:10px 12px;border-bottom:1px solid #2a2a2a;color:#D4A574;font-size:14px;text-align:right;font-weight:600;">$${item.cost.toFixed(2)}</td>
            </tr>`;
          },
        )
        .join("")
    : `<tr><td colspan="3" style="padding:12px;color:#a3a3a3;font-size:14px;text-align:center;">No waste data this week</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Waste Report</title>
</head>
<body style="margin:0;padding:0;background-color:#0A0A0A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">

    <!-- Gold Header Bar -->
    <div style="background:linear-gradient(135deg,#D4A574,#b8834a);border-radius:12px 12px 0 0;padding:24px 28px;">
      <h1 style="margin:0;color:#0A0A0A;font-size:20px;font-weight:700;letter-spacing:0.5px;">CulinAIre Kitchen</h1>
      <p style="margin:6px 0 0;color:#0A0A0A;font-size:13px;opacity:0.8;">Weekly Waste Report</p>
    </div>

    <!-- Content Area -->
    <div style="background-color:#161616;border-radius:0 0 12px 12px;padding:28px;">

      <!-- Greeting -->
      <p style="color:#e5e5e5;font-size:15px;margin:0 0 4px;">Hi ${escapeHtml(name)},</p>
      <p style="color:#a3a3a3;font-size:13px;margin:0 0 24px;">${escapeHtml(dateRange)}</p>

      <!-- Summary Cards -->
      <div style="display:flex;gap:12px;margin-bottom:24px;">
        <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td width="48%" valign="top"><![endif]-->
        <div style="background-color:#1e1e1e;border-radius:10px;padding:20px;flex:1;min-width:0;display:inline-block;width:48%;vertical-align:top;box-sizing:border-box;">
          <p style="color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Total Waste</p>
          <p style="color:#e5e5e5;font-size:26px;font-weight:700;margin:0;">${thisWeek.totalWeight.toFixed(1)} <span style="font-size:14px;color:#a3a3a3;">kg</span></p>
        </div>
        <!--[if mso]></td><td width="4%"></td><td width="48%" valign="top"><![endif]-->
        <div style="background-color:#1e1e1e;border-radius:10px;padding:20px;flex:1;min-width:0;display:inline-block;width:48%;vertical-align:top;box-sizing:border-box;">
          <p style="color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;">Total Cost</p>
          <p style="color:#D4A574;font-size:26px;font-weight:700;margin:0;">$${thisWeek.totalCost.toFixed(2)}</p>
        </div>
        <!--[if mso]></td></tr></table><![endif]-->
      </div>

      <!-- Trend -->
      <div style="background-color:#1e1e1e;border-radius:10px;padding:14px 20px;margin-bottom:24px;">
        <p style="margin:0;font-size:14px;color:${trend.color};font-weight:600;">${escapeHtml(trend.label)}</p>
      </div>

      <!-- Top 3 Items -->
      <h2 style="color:#D4A574;font-size:14px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Top Waste Items</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
        <thead>
          <tr>
            <th style="padding:8px 12px;border-bottom:2px solid #D4A574;color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:left;">Ingredient</th>
            <th style="padding:8px 12px;border-bottom:2px solid #D4A574;color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:right;">Weight</th>
            <th style="padding:8px 12px;border-bottom:2px solid #D4A574;color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:1px;text-align:right;">Cost</th>
          </tr>
        </thead>
        <tbody>
          ${topItemsRows}
        </tbody>
      </table>

      ${reuseTip ? `
      <!-- Reuse Tip -->
      <div style="background-color:#1a1a0f;border:1px solid #3d3520;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <p style="color:#D4A574;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 8px;font-weight:600;">Chef's Tip</p>
        <p style="color:#e5e5e5;font-size:14px;line-height:1.6;margin:0;">${escapeHtml(reuseTip)}</p>
      </div>
      ` : ""}

      <!-- CTA -->
      <div style="text-align:center;margin:28px 0 16px;">
        <a href="${CLIENT_URL}/waste" style="display:inline-block;background:linear-gradient(135deg,#D4A574,#b8834a);color:#0A0A0A;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:14px;">View Full Report</a>
      </div>

      <!-- Footer -->
      <hr style="border:none;border-top:1px solid #2a2a2a;margin:24px 0;" />
      <p style="color:#525252;font-size:12px;text-align:center;margin:0;">
        Manage your waste tracking at <a href="${CLIENT_URL}" style="color:#D4A574;text-decoration:none;">culinaire.kitchen</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
