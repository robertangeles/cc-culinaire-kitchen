/**
 * Pilot: can Jev flag CLAUDE.md rule violations in a diff well enough to be a cheap second reviewer?
 * Measures recall on synthetic violations and false positives on real merged PRs.
 *
 *   node --env-file=.env scripts/jev/lintPilot.mjs
 */
import { execFileSync } from "node:child_process";
import { ask, noul, MODEL } from "./jev.mjs";
import { RULES, THRESHOLD } from "./rules.mjs";
import { BAD, CLEAN_PRS } from "./lintCases.mjs";

const MAX_DIFF_CHARS = 24000; // ~6k tokens; keeps well inside the default context and accuracy range

function prDiff(pr) {
  const sha = execFileSync("gh", ["pr", "view", String(pr), "--json", "mergeCommit", "-q", ".mergeCommit.oid"], { encoding: "utf8" }).trim();
  if (!sha) return ""; // not merged (yet): nothing to measure
  const out = execFileSync("git", ["diff", `${sha}^1`, sha, "--", "packages/server/src", "packages/client/src", "packages/shared/src", ":(exclude)*.test.ts", ":(exclude)*.test.tsx", ":(exclude)*.md"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.slice(0, MAX_DIFF_CHARS);
}

const questions = Object.fromEntries(Object.entries(RULES).map(([k, q]) => [k, noul(q)]));
const score = async (diff) => {
  const res = await ask(diff, questions);
  return { noul: Object.fromEntries(Object.keys(RULES).map((k) => [k, res.answers[k].noul])), tokens: res.usage.input_tokens };
};

let tokens = 0, tp = 0, fn = 0, fp = 0, tn = 0;
const misses = [], flags = [];

for (const [i, c] of BAD.entries()) {
  const r = await score(c.diff);
  tokens += r.tokens;
  for (const rule of Object.keys(RULES)) {
    const hit = r.noul[rule] >= THRESHOLD, should = rule === c.rule;
    if (should && hit) tp++; else if (should && !hit) { fn++; misses.push(`BAD#${i} ${rule} noul=${r.noul[rule].toFixed(2)}`); }
    else if (!should && hit) { fp++; flags.push(`BAD#${i} extra ${rule} noul=${r.noul[rule].toFixed(2)}`); } else tn++;
  }
}
for (const pr of CLEAN_PRS) {
  const diff = prDiff(pr);
  if (!diff.trim()) { console.log(`PR#${pr}: no non-test source diff, skipped`); continue; }
  const r = await score(diff);
  console.log(`PR#${pr}: ${diff.length} chars, max noul ${Math.max(...Object.values(r.noul)).toFixed(2)}`);
  tokens += r.tokens;
  for (const rule of Object.keys(RULES)) {
    if (r.noul[rule] >= THRESHOLD) { fp++; flags.push(`PR#${pr} ${rule} noul=${r.noul[rule].toFixed(2)}`); } else tn++;
  }
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
console.log(`model ${MODEL}, threshold ${THRESHOLD}`);
console.log(`recall on seeded violations: ${tp}/${tp + fn} (${pct(tp, tp + fn)})`);
console.log(`false flags: ${fp} of ${fp + tn} negative checks (${pct(fp, fp + tn)})`);
console.log(`input tokens used: ${tokens} (~$${((tokens / 1e6) * 0.042).toFixed(4)})`);
if (misses.length) console.log("MISSED:\n  " + misses.join("\n  "));
if (flags.length) console.log("FLAGGED (read these):\n  " + flags.join("\n  "));
