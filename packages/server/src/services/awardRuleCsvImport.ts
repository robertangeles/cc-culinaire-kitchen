/**
 * @module services/awardRuleCsvImport
 *
 * CSV bulk-import for award_rule — two-phase preview → commit, same shape
 * as saleService.ts's previewSalesCsv/commitSalesCsv (the established
 * precedent in this codebase: hand-rolled `split(/\r?\n/)` parsing, no CSV
 * library dependency, per-row-atomic commit).
 *
 * Unlike the sales CSV (which matches a name against the DB), every
 * validation rule here is local — no DB round-trip needed to know whether
 * a row is valid, so `previewAwardRuleCsv` is a pure function, unit
 * tested without a DB. Commit reuses `upsertAwardRule` per row (its own
 * transaction each — Section 1's auto-supersede decision, already proven
 * safe under concurrency).
 */

import { ALL_AWARD_RULE_TYPES, AwardRuleError, upsertAwardRule, type AwardRuleRow } from "./awardRuleService.js";
import { AU_JURISDICTIONS } from "./jurisdiction.js";

const MAX_ROWS = 1000;

export interface CsvAwardRuleRow {
  rowIndex: number;
  awardCode: string;
  ruleType: string;
  jurisdiction: string | null;
  thresholdValue: number;
  effectiveFrom: string;
  sourceCitation: string | null;
}

export interface CsvImportPreview {
  valid: CsvAwardRuleRow[];
  invalid: Array<{ rowIndex: number; reason: string }>;
}

const HEADER_RE = /^(award\s*code|rule\s*type|jurisdiction|threshold|effective|source)/i;

/**
 * Parse + validate only — commits nothing. Rows are
 * `awardCode,ruleType,jurisdiction,thresholdValue,effectiveFrom,sourceCitation`;
 * jurisdiction and sourceCitation may be blank (blank jurisdiction = national).
 * A header row and blank rows are skipped, matching previewSalesCsv's convention.
 */
export function previewAwardRuleCsv(csvContent: string): CsvImportPreview {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length > 0 && HEADER_RE.test(lines[0].trim())) lines.shift();

  if (lines.length === 0) {
    throw new AwardRuleError("The CSV file has no data rows", 400);
  }
  if (lines.length > MAX_ROWS) {
    throw new AwardRuleError(`The CSV file has ${lines.length} rows, exceeding the ${MAX_ROWS}-row limit`, 400);
  }

  const valid: CsvAwardRuleRow[] = [];
  const invalid: CsvImportPreview["invalid"] = [];

  lines.forEach((raw, i) => {
    const rowIndex = i + 1; // 1-based, matching how a spreadsheet author counts rows
    const [awardCodeRaw, ruleTypeRaw, jurisdictionRaw, thresholdRaw, effectiveFromRaw, sourceCitationRaw] = raw
      .split(",")
      .map((c) => c.trim());

    const awardCode = awardCodeRaw ?? "";
    if (!awardCode) {
      invalid.push({ rowIndex, reason: "missing awardCode" });
      return;
    }

    const ruleType = ruleTypeRaw ?? "";
    if (!ALL_AWARD_RULE_TYPES.includes(ruleType as (typeof ALL_AWARD_RULE_TYPES)[number])) {
      invalid.push({ rowIndex, reason: `unrecognized ruleType: ${ruleType || "(blank)"}` });
      return;
    }

    const jurisdiction = jurisdictionRaw || null;
    if (jurisdiction !== null && !AU_JURISDICTIONS.includes(jurisdiction)) {
      invalid.push({ rowIndex, reason: `unrecognized jurisdiction code: ${jurisdiction}` });
      return;
    }

    const thresholdValue = Number(thresholdRaw);
    if (!thresholdRaw || !Number.isFinite(thresholdValue) || thresholdValue <= 0) {
      invalid.push({ rowIndex, reason: `thresholdValue must be a positive number, got: ${thresholdRaw || "(blank)"}` });
      return;
    }

    const effectiveFrom = effectiveFromRaw ?? "";
    if (!effectiveFrom || Number.isNaN(new Date(effectiveFrom).getTime())) {
      invalid.push({ rowIndex, reason: `effectiveFrom is missing or unparseable: ${effectiveFrom || "(blank)"}` });
      return;
    }

    valid.push({
      rowIndex,
      awardCode,
      ruleType,
      jurisdiction,
      thresholdValue,
      effectiveFrom,
      sourceCitation: sourceCitationRaw || null,
    });
  });

  return { valid, invalid };
}

export interface CommitResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

/** Rows in flight at once — bounds concurrent DB round trips without serializing all 1000. */
const COMMIT_BATCH_SIZE = 20;

/**
 * Commit rows the client already showed the user in a preview. Each row is
 * its own `upsertAwardRule` call (own transaction, own auto-supersede) —
 * a bad row never rolls back the others, matching commitSalesCsv's
 * per-row-atomic precedent. Rows run in batches of `COMMIT_BATCH_SIZE`
 * concurrently rather than one at a time: at 1000 rows, sequential
 * round trips make this the slowest step in the whole import. Safe to
 * parallelise because `upsertAwardRule` already retries once on a 23505
 * from `idx_award_rule_one_active` — the same backstop that makes two
 * concurrent callers hitting the same (awardCode, ruleType, jurisdiction)
 * key correct, not just fast.
 */
export async function commitAwardRuleCsvImport(rows: CsvAwardRuleRow[], actorUserId: number): Promise<CommitResult> {
  let imported = 0;
  const errors: CommitResult["errors"] = [];

  for (let i = 0; i < rows.length; i += COMMIT_BATCH_SIZE) {
    const batch = rows.slice(i, i + COMMIT_BATCH_SIZE);
    const outcomes = await Promise.allSettled(
      batch.map(
        (row): Promise<AwardRuleRow> =>
          upsertAwardRule(
            {
              awardCode: row.awardCode,
              ruleType: row.ruleType,
              jurisdiction: row.jurisdiction,
              thresholdValue: row.thresholdValue,
              effectiveFrom: row.effectiveFrom,
              sourceCitation: row.sourceCitation,
            },
            actorUserId,
          ),
      ),
    );

    outcomes.forEach((outcome, idx) => {
      if (outcome.status === "fulfilled") {
        if (outcome.value) imported++;
      } else {
        errors.push({
          row: batch[idx].rowIndex,
          reason: outcome.reason instanceof Error ? outcome.reason.message : "failed to save",
        });
      }
    });
  }

  return { imported, skipped: errors.length, errors };
}
