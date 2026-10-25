/**
 * Advisory semantic lint of a branch against the CLAUDE.md rules in rules.mjs, using Jev.
 * Flags are leads for a human or the reviewer to read, never verdicts and never a merge gate.
 *
 *   node --env-file=.env scripts/jev/lint.mjs [base=origin/main] [head=HEAD]
 *
 * DATA RULE: this sends the diff of source files to TypeSafe. Never run it on a diff that
 * contains secrets, production data or user details. Tests, docs and .env files are excluded.
 */
import { execFileSync } from "node:child_process";
import { ask, noul, MODEL } from "./jev.mjs";
import { RULES, THRESHOLD } from "./rules.mjs";

const [base = "origin/main", head = "HEAD"] = process.argv.slice(2);
const MAX_CHARS = 24000; // keeps the request in the model's accurate range; longer diffs are checked in chunks
const files = execFileSync("git", ["diff", "--name-only", `${base}...${head}`, "--", "packages/server/src", "packages/client/src", "packages/shared/src",
  ":(exclude)*.test.ts", ":(exclude)*.test.tsx", ":(exclude)*.md", ":(exclude).env*"], { encoding: "utf8" }).split("\n").filter(Boolean);
if (files.length === 0) { console.log("jev lint: no non-test source changes."); process.exit(0); }

const questions = Object.fromEntries(Object.entries(RULES).map(([k, q]) => [k, noul(q)]));
const flagged = [];
// One request per file keeps each answer attributable to a file and each request small.
for (const file of files) {
  const diff = execFileSync("git", ["diff", `${base}...${head}`, "--", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (let i = 0; i < diff.length; i += MAX_CHARS) {
    const res = await ask(diff.slice(i, i + MAX_CHARS), questions);
    for (const rule of Object.keys(RULES)) {
      const p = res.answers[rule].noul;
      if (p >= THRESHOLD) flagged.push({ file, rule, p });
    }
  }
}
console.log(`jev lint (${MODEL}, threshold ${THRESHOLD}): ${files.length} file(s) checked`);
if (flagged.length === 0) console.log("no rule flagged.");
for (const f of flagged.sort((a, b) => b.p - a.p)) console.log(`  ${f.p.toFixed(2)}  ${f.rule}  ${f.file}`);
