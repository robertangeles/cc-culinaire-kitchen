/**
 * Migration: Create kitchen_profile_option table and seed with default options.
 *
 * This table stores admin-managed selectable options for the kitchen profile
 * personalization wizard and settings tab. Replaces the hardcoded frontend arrays
 * with a database-driven approach — admins can add/remove options without a redeploy.
 *
 * Run: npx tsx packages/server/src/db/migrations/add-kitchen-profile-options.ts
 */
import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(connectionString);

const SKILL_LEVELS = [
  { value: "home_cook",        label: "Home Cook",                       description: "I cook for pleasure and family",         sort: 0 },
  { value: "culinary_student", label: "Culinary Student",                description: "Studying the craft",                     sort: 1 },
  { value: "line_cook",        label: "Line Cook",                       description: "Working in a professional kitchen",       sort: 2 },
  { value: "sous_chef",        label: "Sous Chef",                       description: "Leading a kitchen team",                  sort: 3 },
  { value: "head_chef",        label: "Head Chef / Executive Chef",      description: "Running the show",                        sort: 4 },
  { value: "restaurant_owner", label: "Restaurant Owner / Restaurateur", description: "Running a restaurant business",           sort: 5 },
];

const CUISINES = [
  "French Classical", "Contemporary French", "Italian", "Spanish",
  "Japanese", "Chinese", "Korean", "Thai", "Vietnamese",
  "Indian", "Middle Eastern", "Mexican", "American BBQ",
  "Pastry & Baking", "Plant-Based / Vegan", "Seafood-Focused",
];

const DIETARY = [
  "Vegetarian", "Vegan", "Gluten-Free", "Dairy-Free",
  "Nut-Free", "Kosher", "Halal", "Low-Carb / Keto",
  "Diabetic-Friendly", "Low-FODMAP",
];

const EQUIPMENT = [
  "Home Oven (Conventional)", "Convection Oven", "Combi Oven",
  "Stand Mixer (e.g. KitchenAid)", "Food Processor",
  "Immersion Circulator (Sous Vide)", "Immersion Blender",
  "High-Speed Blender (e.g. Vitamix)", "Thermomix",
  "Induction Cooktop", "Gas Burner", "Carbon Steel Wok",
  "Cast Iron Pan", "Dutch Oven / Cocotte",
  "Chocolate Tempering Equipment", "Pasta Machine",
  "Ice Cream Machine", "Dehydrator", "Smoke Gun",
  "Whipping Siphon (ISI)",
];

/** Convert a label to a slug-style value. */
function toValue(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function run() {
  console.log("Starting migration: add kitchen_profile_option...");

  // Create table
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS kitchen_profile_option (
        option_id          SERIAL PRIMARY KEY,
        option_type        VARCHAR(50)  NOT NULL,
        option_value       VARCHAR(100) NOT NULL,
        option_label       VARCHAR(200) NOT NULL,
        option_description VARCHAR(500),
        sort_order         INTEGER      NOT NULL DEFAULT 0,
        active_ind         BOOLEAN      NOT NULL DEFAULT TRUE,
        created_dttm       TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_dttm       TIMESTAMP    NOT NULL DEFAULT NOW(),
        UNIQUE (option_type, option_value)
      )
    `;
    console.log("kitchen_profile_option table created.");
  } catch {
    console.log("kitchen_profile_option table already exists — skipping.");
  }

  // Create index
  try {
    await sql`
      CREATE INDEX IF NOT EXISTS idx_kpo_type_active
      ON kitchen_profile_option (option_type, active_ind)
    `;
    console.log("Index idx_kpo_type_active created.");
  } catch {
    console.log("Index already exists — skipping.");
  }

  // Seed skill levels
  console.log("Seeding skill levels...");
  for (const s of SKILL_LEVELS) {
    await sql`
      INSERT INTO kitchen_profile_option (option_type, option_value, option_label, option_description, sort_order)
      VALUES ('skill_level', ${s.value}, ${s.label}, ${s.description}, ${s.sort})
      ON CONFLICT (option_type, option_value) DO NOTHING
    `;
  }
  console.log(`  ${SKILL_LEVELS.length} skill levels seeded.`);

  // Seed cuisines
  console.log("Seeding cuisine preferences...");
  for (let i = 0; i < CUISINES.length; i++) {
    const label = CUISINES[i];
    await sql`
      INSERT INTO kitchen_profile_option (option_type, option_value, option_label, sort_order)
      VALUES ('cuisine', ${toValue(label)}, ${label}, ${i})
      ON CONFLICT (option_type, option_value) DO NOTHING
    `;
  }
  console.log(`  ${CUISINES.length} cuisines seeded.`);

  // Seed dietary restrictions
  console.log("Seeding dietary restrictions...");
  for (let i = 0; i < DIETARY.length; i++) {
    const label = DIETARY[i];
    await sql`
      INSERT INTO kitchen_profile_option (option_type, option_value, option_label, sort_order)
      VALUES ('dietary', ${toValue(label)}, ${label}, ${i})
      ON CONFLICT (option_type, option_value) DO NOTHING
    `;
  }
  console.log(`  ${DIETARY.length} dietary options seeded.`);

  // Seed equipment
  console.log("Seeding kitchen equipment...");
  for (let i = 0; i < EQUIPMENT.length; i++) {
    const label = EQUIPMENT[i];
    await sql`
      INSERT INTO kitchen_profile_option (option_type, option_value, option_label, sort_order)
      VALUES ('equipment', ${toValue(label)}, ${label}, ${i})
      ON CONFLICT (option_type, option_value) DO NOTHING
    `;
  }
  console.log(`  ${EQUIPMENT.length} equipment options seeded.`);

  console.log("Migration complete!");
  await sql.end();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
