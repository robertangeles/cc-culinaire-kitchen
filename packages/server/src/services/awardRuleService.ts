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

import { eq, and, or, lte, gte, isNull, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { awardRule } from "../db/schema.js";

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
