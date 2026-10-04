// Fails the E2E run when any test is skipped other than the deliberate ones,
// so a green run cannot hide tests that quietly did not run.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../tests/e2e/_reports/results.json",
);

// file + title identify a test; a count would let a different test skip unnoticed.
export const ALLOWED_SKIPS = [
  {
    file: "public-holidays.spec.ts",
    title:
      "CRITICAL: saving a holiday for a different jurisdiction than the active filter switches the filter to match, and the new holiday is visible",
    reason: "E2E account lacks roster:manage (needs a second role, deferred)",
  },
  {
    file: "roster-calendar.spec.ts",
    title: "dragging on an empty lane creates a Draft shift",
    reason: "lane scrolled out of view / viewport-dependent",
  },
];

function* walk(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* walk(child);
}

/** Returns the skipped tests that are not on the allow list, and the total tests seen. */
export function findUnexpectedSkips(report, allowed = ALLOWED_SKIPS) {
  const unexpected = [];
  let total = 0;
  for (const top of report.suites ?? []) {
    for (const spec of walk(top)) {
      for (const t of spec.tests ?? []) {
        total += 1;
        if (t.status !== "skipped") continue;
        const ok = allowed.some((a) => a.file === spec.file && a.title === spec.title);
        if (!ok) unexpected.push(`${spec.file} > ${spec.title}`);
      }
    }
  }
  return { unexpected, total };
}

function main() {
  let report;
  try {
    report = JSON.parse(readFileSync(REPORT, "utf8"));
  } catch (err) {
    console.error(`E2E skip gate: cannot read ${REPORT}: ${err.message}`);
    process.exit(1);
  }
  const { unexpected, total } = findUnexpectedSkips(report);
  if (total === 0) {
    console.error("E2E skip gate: report contains no tests");
    process.exit(1);
  }
  if (unexpected.length > 0) {
    console.error(`E2E skip gate: ${unexpected.length} unexpected skip(s):`);
    for (const u of unexpected) console.error(`  - ${u}`);
    process.exit(1);
  }
  console.log(`E2E skip gate: ok (${total} tests, no unexpected skips)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
