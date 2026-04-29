// @ts-nocheck
/**
 * Phase 0 #4: snapshot the current Labs prompt's ingredient name shape.
 *
 * Pulls a sample of existing recipes from the DB and captures the structure
 * of recipeData.ingredients[]. Specifically: how often does `name` carry
 * verbose narrative ("chilli flakes, Calabrian or Aleppo preferred...") vs.
 * a clean canonical name? Is `note` consistently used or mixed in?
 *
 * The output JSON is the baseline for Phase 2's prompt change — we'll diff
 * the same shape on post-change recipes and confirm canonical-name uplift.
 *
 * Output: written to `~/.gstack/projects/$SLUG/...` is the wrong place
 *         (those are user artefacts). This snapshot is project state, so it
 *         lives in `packages/server/test/llm-evals/recipe-ingredients-baseline.json`
 *         under git so future engineers can re-run the comparison.
 */
import { config } from "dotenv";
config({ path: "../../.env" });

import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const SAMPLE_SIZE = 30;

// Pull the most recent SAMPLE_SIZE recipes across all domains.
const recipes = await sql`
  SELECT recipe_id, domain, title, recipe_data, created_dttm
  FROM recipe
  WHERE archived_ind = false
  ORDER BY created_dttm DESC
  LIMIT ${SAMPLE_SIZE}
`;

console.log(`\n📸 Snapshot of ${recipes.length} recipes (most recent)\n`);

interface IngredientSummary {
  recipeId: string;
  domain: string;
  title: string;
  ingredient: {
    name: string;
    amount: string;
    unit: string;
    note?: string;
    /** Heuristic flags — useful for diffing pre/post Phase 2 prompt change. */
    nameHasComma: boolean;
    nameHasNarrativeKeyword: boolean;
    nameLen: number;
    notePresent: boolean;
  };
}

const NARRATIVE_KEYWORDS = [
  "preferred",
  "or substitute",
  "to taste",
  "if available",
  "adjust",
  "see notes",
  "optional",
  "approx",
  "about ",
  "preferably",
];

const samples: IngredientSummary[] = [];

let totalIngredients = 0;
let nameWithComma = 0;
let nameWithNarrative = 0;
let notePresent = 0;
let avgNameLen = 0;

for (const r of recipes) {
  const ingredients = (r.recipe_data?.ingredients ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(ingredients)) continue;

  for (const ing of ingredients) {
    totalIngredients++;
    const name = String(ing.name ?? "");
    const note = ing.note ? String(ing.note) : undefined;

    const hasComma = name.includes(",");
    const lower = name.toLowerCase();
    const hasNarrative = NARRATIVE_KEYWORDS.some((kw) => lower.includes(kw));
    const hasNote = !!note && note.length > 0;

    if (hasComma) nameWithComma++;
    if (hasNarrative) nameWithNarrative++;
    if (hasNote) notePresent++;
    avgNameLen += name.length;

    samples.push({
      recipeId: r.recipe_id,
      domain: r.domain,
      title: r.title,
      ingredient: {
        name,
        amount: String(ing.amount ?? ""),
        unit: String(ing.unit ?? ""),
        ...(note ? { note } : {}),
        nameHasComma: hasComma,
        nameHasNarrativeKeyword: hasNarrative,
        nameLen: name.length,
        notePresent: hasNote,
      },
    });
  }
}

avgNameLen = totalIngredients > 0 ? Math.round(avgNameLen / totalIngredients) : 0;

const summary = {
  capturedAt: new Date().toISOString(),
  sampleSize: recipes.length,
  totalIngredients,
  metrics: {
    pctNameHasComma: pct(nameWithComma, totalIngredients),
    pctNameHasNarrativeKeyword: pct(nameWithNarrative, totalIngredients),
    pctNotePresent: pct(notePresent, totalIngredients),
    avgNameLength: avgNameLen,
  },
  byDomain: bucketByDomain(samples),
};

console.log("Baseline metrics:");
console.log(`  • Sample: ${summary.sampleSize} recipes, ${totalIngredients} ingredient rows`);
console.log(`  • % with comma in name: ${summary.metrics.pctNameHasComma}%`);
console.log(`  • % with narrative keyword: ${summary.metrics.pctNameHasNarrativeKeyword}%`);
console.log(`  • % with separate note field: ${summary.metrics.pctNotePresent}%`);
console.log(`  • Avg name length: ${summary.metrics.avgNameLength} chars`);
console.log("\nBy domain:");
for (const [domain, stats] of Object.entries(summary.byDomain)) {
  console.log(`  • ${domain}: ${stats.recipes} recipes, ${stats.ingredients} ingredients, ${stats.pctNarrative}% narrative`);
}

// Write out — destination is project test/llm-evals/, not the user's gstack dir.
const outPath = resolve(
  process.cwd(),
  "test/llm-evals/recipe-ingredients-baseline.json",
);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ summary, samples: samples.slice(0, 100) }, null, 2),
);
console.log(`\n✅ Baseline written: ${outPath}`);
console.log("   This file is git-tracked. Re-run after Phase 2 prompt change to measure the lift.\n");

await sql.end();
process.exit(0);

// ─── helpers ────────────────────────────────────────────────────────

function pct(n: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function bucketByDomain(samples: IngredientSummary[]): Record<string, { recipes: number; ingredients: number; pctNarrative: number }> {
  const buckets: Record<string, { recipeIds: Set<string>; ingredients: number; narrative: number }> = {};
  for (const s of samples) {
    if (!buckets[s.domain]) {
      buckets[s.domain] = { recipeIds: new Set(), ingredients: 0, narrative: 0 };
    }
    const b = buckets[s.domain]!;
    b.recipeIds.add(s.recipeId);
    b.ingredients++;
    if (s.ingredient.nameHasNarrativeKeyword) b.narrative++;
  }
  const out: Record<string, { recipes: number; ingredients: number; pctNarrative: number }> = {};
  for (const [d, b] of Object.entries(buckets)) {
    out[d] = {
      recipes: b.recipeIds.size,
      ingredients: b.ingredients,
      pctNarrative: pct(b.narrative, b.ingredients),
    };
  }
  return out;
}
