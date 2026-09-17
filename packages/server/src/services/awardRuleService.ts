/**
 * @module services/awardRuleService
 *
 * Award interpretation engine (Phase 2, Slice 4) — advisory-only, versioned,
 * never blocks. Ships with ZERO award_rule rows: nobody on this project is
 * named as competent to author Award thresholds (MA000009 varies several
 * times a year and requires industrial-relations expertise this project
 * does not have). The machinery is real; the data is deliberately absent.
 *
 * Every evaluation returns BOTH `warnings` and `coverage` — what the engine
 * checked and what it explicitly did not. This exists because an empty
 * `warnings[]` is itself a signal: without an explicit coverage disclosure,
 * silence reads as "the system verified this roster is compliant," which is
 * false when (as today) zero rules exist to check against. That misreading
 * is the documented mechanism behind large Australian underpayment cases.
 *
 * `checked`/`notChecked` are a property of the CODE — which rule types this
 * engine knows how to evaluate — independent of how many award_rule rows
 * currently exist for them. Two rule types are implemented, chosen because
 * they are computable from a single shift's own start/end time without
 * inventing data this schema doesn't track (e.g. break minutes) or judgment
 * calls about rolling-window definitions this project has no authority to
 * make (e.g. weekly aggregate hours, minimum rest between shifts):
 *   - max_ordinary_hours — this shift's own duration must not exceed the rule's threshold
 *   - publish_notice     — hours between "now" and the shift's start must meet the rule's threshold
 * Everything else (min_break, min_rest, penalty_rates, allowances,
 * casual_loading, overtime, public_holiday_rates) is honestly disclosed as
 * not checked.
 *
 * Formulas:
 *   F-AR-01  evaluateAwardRules — pure per-shift warnings + coverage
 */

import { eq, and, or, lte, gte, isNull, inArray, sql, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { awardRule } from "../db/schema.js";
import { AU_JURISDICTIONS } from "./jurisdiction.js";
import * as auditService from "./auditService.js";

export const AWARD_CHECKED_RULE_TYPES = ["max_ordinary_hours", "publish_notice"] as const;
export const AWARD_NOT_CHECKED_RULE_TYPES = [
  "min_break",
  "min_rest",
  "penalty_rates",
  "allowances",
  "casual_loading",
  "overtime",
  "public_holiday_rates",
] as const;

export const ALL_AWARD_RULE_TYPES = [...AWARD_CHECKED_RULE_TYPES, ...AWARD_NOT_CHECKED_RULE_TYPES] as const;

/**
 * Own error class, not a reuse of RosterError — rosterService.ts imports
 * FROM this module (its evaluate()/getActiveAwardRules() are used by the
 * publish-time Award coverage disclosure), so importing RosterError back
 * from rosterService.ts here would be a circular import.
 */
export class AwardRuleError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "AwardRuleError";
  }
}

export interface AwardWarning {
  severity: "advisory";
  message: string;
  ruleVersion: string;
  sourceCitation: string | null;
}

export interface AwardCoverage {
  checked: string[];
  notChecked: string[];
  ruleVersionsInScope: string[];
  jurisdiction: string | null;
}

export interface AwardEvaluation {
  warnings: AwardWarning[];
  coverage: AwardCoverage;
}

export interface ActiveAwardRule {
  ruleType: string;
  thresholdValue: number;
  ruleVersion: string;
  sourceCitation: string | null;
}

export interface ShiftTiming {
  startDatetime: string;
  endDatetime: string;
}

/**
 * Coverage does not depend on any one shift's timing — only which rule
 * types the code checks and which rules are currently active. Exported
 * separately so a caller evaluating a whole publish batch (zero or more
 * shifts) can always show the disclosure, even when there is nothing to
 * evaluate warnings against.
 */
export function buildAwardCoverage(activeRules: ActiveAwardRule[], jurisdiction: string | null): AwardCoverage {
  return {
    checked: [...AWARD_CHECKED_RULE_TYPES],
    notChecked: [...AWARD_NOT_CHECKED_RULE_TYPES],
    ruleVersionsInScope: [...new Set(activeRules.map((r) => r.ruleVersion))],
    jurisdiction,
  };
}

const HOUR_MS = 60 * 60 * 1000;

type CheckedRuleType = (typeof AWARD_CHECKED_RULE_TYPES)[number];

interface EvalContext {
  startMs: number;
  endMs: number;
  nowMs: number;
}

type RuleEvaluator = (rule: ActiveAwardRule, ctx: EvalContext) => AwardWarning | null;

/**
 * One evaluator per entry in AWARD_CHECKED_RULE_TYPES — keyed by a `Record`
 * over that same union, so adding/removing a checked rule type without a
 * matching evaluator (or vice versa) is a TypeScript compile error, not a
 * silent coverage/behaviour mismatch. This is the mechanism that keeps the
 * `coverage.checked` disclosure honest: it is structurally impossible for a
 * type to appear in AWARD_CHECKED_RULE_TYPES without also having code that
 * actually evaluates it.
 */
const RULE_EVALUATORS: Record<CheckedRuleType, RuleEvaluator> = {
  max_ordinary_hours: (rule, { startMs, endMs }) => {
    const durationHours = (endMs - startMs) / HOUR_MS;
    if (durationHours <= rule.thresholdValue) return null;
    return {
      severity: "advisory",
      message: `This shift is ${round1(durationHours)} hours long, exceeding the Award's ${rule.thresholdValue}-hour ordinary-hours limit.`,
      ruleVersion: rule.ruleVersion,
      sourceCitation: rule.sourceCitation,
    };
  },
  publish_notice: (rule, { startMs, nowMs }) => {
    const noticeHours = (startMs - nowMs) / HOUR_MS;
    if (noticeHours >= rule.thresholdValue) return null;
    return {
      severity: "advisory",
      message: `This shift starts in ${round1(noticeHours)} hours, less than the Award's required ${rule.thresholdValue} hours' notice.`,
      ruleVersion: rule.ruleVersion,
      sourceCitation: rule.sourceCitation,
    };
  },
};

/**
 * Pure — no DB. `now` is injected (ISO datetime) so publish_notice is
 * testable without mocking the clock, same convention as
 * complianceExpiryMath's `today` parameter.
 */
export function evaluateAwardRules(
  shift: ShiftTiming,
  activeRules: ActiveAwardRule[],
  now: string,
  jurisdiction: string | null,
): AwardEvaluation {
  const warnings: AwardWarning[] = [];
  const ctx: EvalContext = {
    startMs: new Date(shift.startDatetime).getTime(),
    endMs: new Date(shift.endDatetime).getTime(),
    nowMs: new Date(now).getTime(),
  };

  for (const rule of activeRules) {
    const evaluator = RULE_EVALUATORS[rule.ruleType as CheckedRuleType];
    const warning = evaluator?.(rule, ctx);
    if (warning) warnings.push(warning);
  }

  return { warnings, coverage: buildAwardCoverage(activeRules, jurisdiction) };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The active rules (of the types this engine checks) for a jurisdiction as of `today`, preferring an exact jurisdiction match over the national (NULL) rule per type. */
export async function getActiveAwardRules(jurisdiction: string | null, today: string): Promise<ActiveAwardRule[]> {
  const rows = await db
    .select()
    .from(awardRule)
    .where(
      and(
        inArray(awardRule.ruleType, [...AWARD_CHECKED_RULE_TYPES]),
        lte(awardRule.effectiveFrom, today),
        or(isNull(awardRule.effectiveTo), gte(awardRule.effectiveTo, today)),
        or(isNull(awardRule.jurisdiction), jurisdiction ? eq(awardRule.jurisdiction, jurisdiction) : undefined),
      ),
    );

  const byType = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = byType.get(row.ruleType);
    // Exact jurisdiction match wins over the national (NULL) row for the same type.
    if (!existing || (existing.jurisdiction === null && row.jurisdiction !== null)) {
      byType.set(row.ruleType, row);
    }
  }
  return [...byType.values()]
    .filter((r) => r.thresholdValue !== null)
    .map((r) => ({
      ruleType: r.ruleType,
      thresholdValue: Number(r.thresholdValue),
      ruleVersion: r.ruleVersion,
      sourceCitation: r.sourceCitation,
    }));
}

/** DB-touching wrapper: fetch active rules, then evaluate one shift against them. */
export async function evaluate(jurisdiction: string | null, shift: ShiftTiming, now: string): Promise<AwardEvaluation> {
  const today = now.slice(0, 10);
  const activeRules = await getActiveAwardRules(jurisdiction, today);
  return evaluateAwardRules(shift, activeRules, now, jurisdiction);
}

/**
 * Active rows only (`effectiveTo IS NULL`) — per the plan's design decision,
 * the admin table shows currently-active rules; superseded rows are history,
 * visible only via the audit log (item 9), not this list.
 */
export async function listAwardRules(): Promise<AwardRuleRow[]> {
  return db
    .select()
    .from(awardRule)
    .where(isNull(awardRule.effectiveTo))
    .orderBy(asc(awardRule.ruleType), asc(awardRule.jurisdiction));
}

export interface AwardRuleInput {
  awardCode: string;
  ruleType: string;
  /** NULL = national. Must be one of AU_JURISDICTIONS, checked below — a typo
   * (e.g. "NWS") would otherwise create a row idx_award_rule_lookup can
   * never match, keeping Award engine coverage silently stuck at 0. */
  jurisdiction: string | null;
  thresholdValue: number;
  effectiveFrom: string;
  sourceCitation: string | null;
}

export interface AwardRuleRow {
  awardRuleId: string;
  awardCode: string;
  ruleType: string;
  jurisdiction: string | null;
  thresholdValue: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceCitation: string | null;
  ruleVersion: string;
}

/**
 * Create a new award_rule version for (ruleType, jurisdiction), closing out
 * the currently-active version — same auto-supersede pattern as
 * complianceService.ts's upsertExpiryRule, reused deliberately rather than
 * designed from scratch (see this plan's Section 1 correction).
 *
 * `ruleVersion` is never user input — generated here as `v${effectiveFrom}`,
 * tying the tag to when this version became effective rather than
 * implying a fake official MA000009 document-version number.
 *
 * Same-day-edit guard and race-safety (idx_award_rule_one_active, 23505
 * catch-and-retry) mirror upsertExpiryRule exactly — see that function's
 * doc comment for the full reasoning.
 */
export async function upsertAwardRule(input: AwardRuleInput, actorUserId: number): Promise<AwardRuleRow> {
  const awardCode = input.awardCode.trim();
  if (!awardCode) throw new AwardRuleError("An award code is required", 400);

  if (!ALL_AWARD_RULE_TYPES.includes(input.ruleType as (typeof ALL_AWARD_RULE_TYPES)[number])) {
    throw new AwardRuleError(`Unrecognized rule type: ${input.ruleType}`, 400);
  }

  const jurisdiction = input.jurisdiction?.trim() || null;
  if (jurisdiction !== null && !AU_JURISDICTIONS.includes(jurisdiction)) {
    throw new AwardRuleError(`Unrecognized jurisdiction code: ${jurisdiction}`, 400);
  }

  if (!Number.isFinite(input.thresholdValue) || input.thresholdValue <= 0) {
    throw new AwardRuleError("Threshold value must be a positive number", 400);
  }

  if (!input.effectiveFrom) throw new AwardRuleError("An effective-from date is required", 400);

  return upsertAwardRuleAttempt(awardCode, input.ruleType, jurisdiction, input, actorUserId);
}

async function upsertAwardRuleAttempt(
  awardCode: string,
  ruleType: string,
  jurisdiction: string | null,
  input: AwardRuleInput,
  actorUserId: number,
  isRetry = false,
): Promise<AwardRuleRow> {
  try {
    return await db.transaction(async (tx) => {
      const activeMatch = jurisdiction
        ? and(eq(awardRule.ruleType, ruleType), eq(awardRule.jurisdiction, jurisdiction))
        : and(eq(awardRule.ruleType, ruleType), isNull(awardRule.jurisdiction));

      const [activeRow] = await tx
        .select({ awardRuleId: awardRule.awardRuleId, effectiveFrom: awardRule.effectiveFrom })
        .from(awardRule)
        .where(and(activeMatch, isNull(awardRule.effectiveTo)));

      if (activeRow && input.effectiveFrom <= activeRow.effectiveFrom) {
        throw new AwardRuleError(
          "This rule was already updated today — edit the existing row directly instead of creating a new version",
          409,
        );
      }

      if (activeRow) {
        await tx
          .update(awardRule)
          .set({
            effectiveTo: sql`(${input.effectiveFrom}::date - 1)`,
            updatedDttm: new Date(),
          })
          .where(and(activeMatch, isNull(awardRule.effectiveTo)));

        await auditService.log(
          {
            entityType: "award_rule",
            entityId: activeRow.awardRuleId,
            action: "update",
            actorUserId,
            metadata: { closedBy: "auto-supersede" },
          },
          tx,
        );
      }

      const [created] = await tx
        .insert(awardRule)
        .values({
          awardCode,
          ruleType,
          jurisdiction,
          thresholdValue: String(input.thresholdValue),
          effectiveFrom: input.effectiveFrom,
          sourceCitation: input.sourceCitation ?? null,
          ruleVersion: `v${input.effectiveFrom}`,
        })
        .returning();

      await auditService.log(
        {
          entityType: "award_rule",
          entityId: created.awardRuleId,
          action: "create",
          actorUserId,
          afterValue: created,
        },
        tx,
      );

      return created;
    });
  } catch (err) {
    // 23505 = unique_violation — a concurrent create won the race on
    // idx_award_rule_one_active. Retry once: the re-read now sees the
    // winner's closed row and completes cleanly.
    if (!isRetry && (err as { code?: string })?.code === "23505") {
      return upsertAwardRuleAttempt(awardCode, ruleType, jurisdiction, input, actorUserId, true);
    }
    throw err;
  }
}
