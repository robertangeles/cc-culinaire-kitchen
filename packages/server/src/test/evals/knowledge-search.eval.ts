/**
 * @eval knowledge-search
 *
 * Golden set evaluation for the culinary knowledge search service.
 * Tests that `searchKnowledge()` returns relevant results for 20 queries
 * spanning techniques, pastry, spirits, and ingredients.
 *
 * Run: tsx packages/server/src/test/evals/knowledge-search.eval.ts
 *
 * Each test case defines:
 *  - query: the search string
 *  - expectedTerms: strings that MUST appear in at least one result title/snippet
 *  - forbiddenTerms: strings that must NOT appear in any result (hallucination guard)
 *  - minResults: minimum number of results expected
 */

import "dotenv/config";
import { searchKnowledge, syncDocuments } from "../../services/knowledgeService.js";

interface EvalCase {
  id: string;
  query: string;
  category?: string;
  expectedTerms: string[];
  forbiddenTerms?: string[];
  minResults: number;
}

const EVAL_CASES: EvalCase[] = [
  // -------------------------------------------------------------------------
  // Techniques
  // -------------------------------------------------------------------------
  {
    id: "T01",
    query: "how to sear meat properly",
    category: "techniques",
    expectedTerms: ["sear", "maillard", "heat"],
    minResults: 1,
  },
  {
    id: "T02",
    query: "emulsification sauce hollandaise",
    expectedTerms: ["emuls"],
    minResults: 1,
  },
  {
    id: "T03",
    query: "braising collagen gelatin low slow",
    category: "techniques",
    expectedTerms: ["brais"],
    minResults: 1,
  },
  {
    id: "T04",
    query: "sous vide temperature control",
    expectedTerms: ["temperature"],
    minResults: 1,
  },
  {
    id: "T05",
    query: "knife skills brunoise julienne",
    expectedTerms: ["knife", "cut"],
    minResults: 1,
  },

  // -------------------------------------------------------------------------
  // Pastry
  // -------------------------------------------------------------------------
  {
    id: "P01",
    query: "chocolate tempering crystallisation",
    category: "pastry",
    expectedTerms: ["temper", "chocolate"],
    minResults: 1,
  },
  {
    id: "P02",
    query: "croissant lamination butter layers",
    expectedTerms: ["lamin", "croissant"],
    minResults: 1,
  },
  {
    id: "P03",
    query: "choux pastry pate eclair cream puff",
    category: "pastry",
    expectedTerms: ["choux"],
    minResults: 1,
  },
  {
    id: "P04",
    query: "custard egg yolk coagulation tart",
    expectedTerms: ["custard", "egg"],
    minResults: 1,
  },
  {
    id: "P05",
    query: "bread dough gluten development fermentation yeast",
    expectedTerms: ["bread", "gluten"],
    minResults: 1,
  },

  // -------------------------------------------------------------------------
  // Spirits
  // -------------------------------------------------------------------------
  {
    id: "S01",
    query: "classic Negroni cocktail recipe",
    category: "spirits",
    expectedTerms: ["negroni"],
    minResults: 1,
  },
  {
    id: "S02",
    query: "cocktail balance sweet sour bitter spirit",
    category: "spirits",
    expectedTerms: ["balance", "cocktail"],
    minResults: 1,
  },
  {
    id: "S03",
    query: "daiquiri shaking technique lime rum",
    expectedTerms: ["daiquiri", "rum"],
    minResults: 1,
  },
  {
    id: "S04",
    query: "whisky Old Fashioned stirred bitters",
    expectedTerms: ["old fashioned", "stirred"],
    minResults: 1,
  },
  {
    id: "S05",
    query: "vermouth fortified wine aperitivo",
    expectedTerms: ["vermouth"],
    minResults: 1,
  },

  // -------------------------------------------------------------------------
  // Ingredients
  // -------------------------------------------------------------------------
  {
    id: "I01",
    query: "acid lemon juice vinegar balance",
    category: "ingredients",
    expectedTerms: ["acid"],
    minResults: 1,
  },
  {
    id: "I02",
    query: "herbs thyme rosemary bay leaf usage",
    expectedTerms: ["herb"],
    minResults: 1,
  },
  {
    id: "I03",
    query: "fats butter oil smoke point",
    expectedTerms: ["fat", "butter"],
    minResults: 1,
  },
  {
    id: "I04",
    query: "protein meat fish poultry cooking",
    expectedTerms: ["protein"],
    minResults: 1,
  },
  {
    id: "I05",
    query: "seasonal produce freshness storage",
    expectedTerms: ["season", "fresh"],
    minResults: 1,
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface EvalResult {
  id: string;
  passed: boolean;
  reason?: string;
  results: { title: string; snippet: string }[];
}

async function runEval(c: EvalCase): Promise<EvalResult> {
  try {
    const results = await searchKnowledge(c.query, c.category);

    if (results.length < c.minResults) {
      return {
        id: c.id,
        passed: false,
        reason: `Expected ≥${c.minResults} results, got ${results.length}`,
        results,
      };
    }

    const combinedText = results
      .flatMap((r) => [r.title, r.snippet])
      .join(" ")
      .toLowerCase();

    for (const term of c.expectedTerms) {
      if (!combinedText.includes(term.toLowerCase())) {
        return {
          id: c.id,
          passed: false,
          reason: `Expected term "${term}" not found in results`,
          results,
        };
      }
    }

    for (const term of c.forbiddenTerms ?? []) {
      if (combinedText.includes(term.toLowerCase())) {
        return {
          id: c.id,
          passed: false,
          reason: `Forbidden term "${term}" found in results`,
          results,
        };
      }
    }

    return { id: c.id, passed: true, results };
  } catch (err) {
    return {
      id: c.id,
      passed: false,
      reason: `Error: ${err instanceof Error ? err.message : String(err)}`,
      results: [],
    };
  }
}

async function main() {
  console.log("=== Knowledge Search Eval Suite ===\n");

  // Sync documents before running evals
  await syncDocuments();

  const results = await Promise.all(EVAL_CASES.map(runEval));

  let passed = 0;
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} [${r.id}]${r.reason ? ` — ${r.reason}` : ""}`);
    if (!r.passed) {
      console.log("  Top results:", r.results.slice(0, 2).map((x) => x.title).join(", ") || "(none)");
    }
    if (r.passed) passed++;
  }

  const total = results.length;
  console.log(`\n${passed}/${total} passed`);
  if (passed < total) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
