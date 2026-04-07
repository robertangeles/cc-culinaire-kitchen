/**
 * @module db/sync-model-pricing
 *
 * Fetches current pricing and context length from OpenRouter for all
 * enabled models in the model_option table and updates them in place.
 *
 * Usage:
 * ```sh
 * cd packages/server
 * npx tsx src/db/sync-model-pricing.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

const postgres = (await import("postgres")).default;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

// Hydrate credentials from DB (API key is stored encrypted, not in .env)
const { hydrateEnvFromCredentials } = await import("../services/credentialService.js");
await hydrateEnvFromCredentials();

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) { console.error("❌ OPENROUTER_API_KEY not set (check Integrations → AI Configuration)"); process.exit(1); }

const sql = postgres(DATABASE_URL, { max: 1 });

console.log("\n🔄 Fetching pricing from OpenRouter...\n");

const res = await fetch("https://openrouter.ai/api/v1/models", {
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "HTTP-Referer": process.env.CLIENT_URL ?? "http://localhost:5179",
    "X-Title": "CulinAIre Kitchen",
  },
});

if (!res.ok) {
  console.error(`❌ OpenRouter returned ${res.status}`);
  process.exit(1);
}

interface ORModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

const data = (await res.json()) as { data: ORModel[] };
const catalog = new Map<string, ORModel>();
for (const m of data.data) {
  catalog.set(m.id, m);
}

// Get all models in our DB
const rows = await sql`SELECT model_option_id, model_id, display_name FROM model_option`;

let updated = 0;
for (const row of rows) {
  const or = catalog.get(row.model_id);
  if (!or) {
    console.log(`  ⊘ ${row.display_name} — not found in OpenRouter catalog`);
    continue;
  }

  const perTokenToPerM = (val?: string): string | null => {
    if (!val) return null;
    const n = parseFloat(val);
    if (isNaN(n)) return null;
    return (n * 1_000_000).toFixed(4);
  };

  const inputCost = perTokenToPerM(or.pricing?.prompt);
  const outputCost = perTokenToPerM(or.pricing?.completion);
  const ctxLen = or.context_length ?? null;

  await sql`
    UPDATE model_option
    SET context_length = ${ctxLen},
        input_cost_per_m = ${inputCost},
        output_cost_per_m = ${outputCost},
        updated_dttm = now()
    WHERE model_option_id = ${row.model_option_id}
  `;

  console.log(`  ✓ ${row.display_name} — ${inputCost ?? "free"}/M in, ${outputCost ?? "free"}/M out, ${ctxLen ? `${(ctxLen/1000).toFixed(0)}k ctx` : "no ctx"}`);
  updated++;
}

console.log(`\n✅ Updated pricing for ${updated}/${rows.length} models.\n`);
await sql.end();
