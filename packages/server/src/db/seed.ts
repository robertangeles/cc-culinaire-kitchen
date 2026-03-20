/**
 * @module db/seed
 *
 * Standalone seed script that populates the `prompt` table with the
 * system prompt read from `prompts/chatbot/systemPrompt.md`.
 *
 * Two rows are inserted per prompt name:
 *   - **active copy** (`default_ind = false`) — the version the app uses
 *     and that admins can edit at runtime.
 *   - **default copy** (`default_ind = true`) — an immutable factory
 *     baseline used for "reset to default" functionality.
 *
 * The script is idempotent: existing rows are skipped, not overwritten.
 *
 * Usage:
 * ```sh
 * npx tsx src/db/seed.ts
 * ```
 */

import { config } from "dotenv";
config({ path: "../../.env" });

// Dynamic imports are used so dotenv can load DATABASE_URL before
// the db module attempts to connect.
const { readFile } = await import("fs/promises");
const { join, dirname } = await import("path");
const { fileURLToPath } = await import("url");
const matter = (await import("gray-matter")).default;
const { db } = await import("./index.js");
const { prompt, role, permission, rolePermission, siteSetting, guide } = await import("./schema.js");
const { eq, and } = await import("drizzle-orm");

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Absolute path to the chatbot prompts directory in the monorepo. */
const PROMPTS_DIR = join(__dirname, "../../../../prompts/chatbot");
/** Absolute path to the recipe prompts directory in the monorepo. */
const RECIPE_PROMPTS_DIR = join(__dirname, "../../../../prompts/recipe");

/**
 * Reads the system prompt markdown file and seeds both the active and
 * default prompt rows into the database. Skips insertion if the rows
 * already exist.
 */
async function seed() {
  console.log("Seeding database...");

  // Read the system prompt markdown and strip front-matter via gray-matter
  const filePath = join(PROMPTS_DIR, "systemPrompt.md");
  const raw = await readFile(filePath, "utf-8");
  const { content } = matter(raw);
  const promptContent = content.trim();

  // --- Active prompt (default_ind = false) ---
  const existing = await db
    .select()
    .from(prompt)
    .where(and(eq(prompt.promptName, "systemPrompt"), eq(prompt.defaultInd, false)));

  if (existing.length === 0) {
    await db.insert(prompt).values({
      promptName: "systemPrompt",
      promptKey: "system-prompt",
      promptBody: promptContent,
      defaultInd: false,
    });
    console.log("Inserted active systemPrompt");
  } else {
    console.log("Active systemPrompt already exists, skipping");
  }

  // --- Default / factory-baseline prompt (default_ind = true) ---
  const existingDefault = await db
    .select()
    .from(prompt)
    .where(and(eq(prompt.promptName, "systemPrompt"), eq(prompt.defaultInd, true)));

  if (existingDefault.length === 0) {
    await db.insert(prompt).values({
      promptName: "systemPrompt",
      promptKey: "system-prompt",
      promptBody: promptContent,
      defaultInd: true,
    });
    console.log("Inserted default systemPrompt");
  } else {
    console.log("Default systemPrompt already exists, skipping");
  }

  // -----------------------------------------------------------------
  // Seed recipe lab prompts (recipe, patisserie, spirits)
  // -----------------------------------------------------------------
  const recipePrompts = [
    { name: "recipePrompt", key: "recipe-prompt", file: "recipePromptV2.md" },
    { name: "patisseriePrompt", key: "patisserie-prompt", file: "patisseriePrompt.md" },
    { name: "spiritsPrompt", key: "spirits-prompt", file: "spiritsPrompt.md" },
    { name: "recipeRefinementPrompt", key: "recipe-refinement-prompt", file: "recipeRefinementPrompt.md" },
  ];

  for (const rp of recipePrompts) {
    try {
      const rpPath = join(RECIPE_PROMPTS_DIR, rp.file);
      const rpRaw = await readFile(rpPath, "utf-8");
      const rpContent = matter(rpRaw).content.trim();

      // Active copy
      const rpExisting = await db
        .select()
        .from(prompt)
        .where(and(eq(prompt.promptName, rp.name), eq(prompt.defaultInd, false)));

      if (rpExisting.length === 0) {
        await db.insert(prompt).values({
          promptName: rp.name,
          promptKey: rp.key,
          promptBody: rpContent,
          defaultInd: false,
        });
        console.log(`Inserted active ${rp.name}`);
      } else {
        console.log(`Active ${rp.name} already exists, skipping`);
      }

      // Default copy
      const rpDefault = await db
        .select()
        .from(prompt)
        .where(and(eq(prompt.promptName, rp.name), eq(prompt.defaultInd, true)));

      if (rpDefault.length === 0) {
        await db.insert(prompt).values({
          promptName: rp.name,
          promptKey: rp.key,
          promptBody: rpContent,
          defaultInd: true,
        });
        console.log(`Inserted default ${rp.name}`);
      } else {
        console.log(`Default ${rp.name} already exists, skipping`);
      }
    } catch (err) {
      console.warn(`Warning: Could not seed ${rp.name} — file may not exist:`, (err as Error).message);
    }
  }

  // -----------------------------------------------------------------
  // Seed default roles
  // -----------------------------------------------------------------
  const defaultRoles = [
    { roleName: "Administrator", roleDescription: "Full system access" },
    { roleName: "Subscriber", roleDescription: "Default role after email verification (free tier)" },
    { roleName: "Paid Subscriber", roleDescription: "Paid subscription tier with unlimited access" },
  ];

  for (const r of defaultRoles) {
    const exists = await db
      .select()
      .from(role)
      .where(eq(role.roleName, r.roleName));
    if (exists.length === 0) {
      await db.insert(role).values(r);
      console.log(`Inserted role: ${r.roleName}`);
    } else {
      console.log(`Role ${r.roleName} already exists, skipping`);
    }
  }

  // -----------------------------------------------------------------
  // Seed default permissions
  // -----------------------------------------------------------------
  const defaultPermissions = [
    { permissionKey: "admin:dashboard", permissionDescription: "Access the administrator dashboard and overview" },
    { permissionKey: "admin:manage-users", permissionDescription: "View, edit, suspend, and delete user accounts" },
    { permissionKey: "admin:manage-roles", permissionDescription: "Create, edit, and delete roles and assign permissions" },
    { permissionKey: "admin:manage-settings", permissionDescription: "Manage site settings, prompts, and integrations" },
    { permissionKey: "chat:access", permissionDescription: "Access the AI chat functionality" },
    { permissionKey: "chat:unlimited", permissionDescription: "Unlimited chat sessions without usage limits" },
    { permissionKey: "org:create-organisation", permissionDescription: "Create new organisations" },
    { permissionKey: "org:manage-organisation", permissionDescription: "Manage organisation settings and members" },
  ];

  for (const p of defaultPermissions) {
    const exists = await db
      .select()
      .from(permission)
      .where(eq(permission.permissionKey, p.permissionKey));
    if (exists.length === 0) {
      await db.insert(permission).values(p);
      console.log(`Inserted permission: ${p.permissionKey}`);
    } else {
      console.log(`Permission ${p.permissionKey} already exists, skipping`);
    }
  }

  // -----------------------------------------------------------------
  // Seed role-permission mappings
  // -----------------------------------------------------------------
  const rolePermMappings: Record<string, string[]> = {
    Administrator: [
      "admin:dashboard", "admin:manage-users", "admin:manage-roles", "admin:manage-settings",
      "chat:access", "chat:unlimited", "org:create-organisation", "org:manage-organisation",
    ],
    Subscriber: ["chat:access", "org:create-organisation"],
    "Paid Subscriber": ["chat:access", "chat:unlimited", "org:create-organisation", "org:manage-organisation"],
  };

  const allRoles = await db.select().from(role);
  const allPerms = await db.select().from(permission);
  const existingRolePerms = await db.select().from(rolePermission);

  for (const [roleName, permKeys] of Object.entries(rolePermMappings)) {
    const r = allRoles.find((row) => row.roleName === roleName);
    if (!r) continue;

    for (const pk of permKeys) {
      const p = allPerms.find((row) => row.permissionKey === pk);
      if (!p) continue;

      const alreadyLinked = existingRolePerms.some(
        (rp) => rp.roleId === r.roleId && rp.permissionId === p.permissionId,
      );
      if (!alreadyLinked) {
        await db.insert(rolePermission).values({
          roleId: r.roleId,
          permissionId: p.permissionId,
        });
        console.log(`Linked ${roleName} → ${pk}`);
      }
    }
  }

  // -----------------------------------------------------------------
  // Seed default site settings
  // -----------------------------------------------------------------
  const defaultSettings: Array<{ key: string; value: string }> = [
    { key: "page_title", value: "CulinAIre Kitchen" },
    { key: "title_separator", value: "|" },
    { key: "tagline", value: "Your AI Culinary Knowledge Engine" },
    { key: "meta_description", value: "AI-powered platform for chefs, restaurateurs, and culinary professionals" },
    { key: "robots_meta", value: "index, follow" },
    { key: "footer_text", value: "© 2026 CulinAIre Kitchen. All rights reserved." },
    { key: "web_search_enabled", value: "false" },
    { key: "image_generation_enabled", value: "false" },
    { key: "image_generation_model", value: "gemini-2.0-flash-exp-image-generation" },
    { key: "vector_search_enabled", value: "false" },
    { key: "guest_session_idle_hours", value: "24" },
    { key: "default_guest_sessions", value: "10" },
    { key: "default_registered_sessions", value: "10" },
    { key: "recipe_archive_retention_days", value: "30" },
  ];

  for (const s of defaultSettings) {
    const exists = await db
      .select()
      .from(siteSetting)
      .where(eq(siteSetting.settingKey, s.key));
    if (exists.length === 0) {
      await db.insert(siteSetting).values({ settingKey: s.key, settingValue: s.value });
      console.log(`Inserted setting: ${s.key} = ${s.value}`);
    } else {
      console.log(`Setting ${s.key} already exists, skipping`);
    }
  }

  // -----------------------------------------------------------------
  // Seed default user guides
  // -----------------------------------------------------------------
  const defaultGuides = [
    {
      guideKey: "waste_intelligence",
      title: "Getting Started with Waste Intelligence",
      content: `# Getting Started with Waste Intelligence\n\n## Step 1: Log Your First Waste\nGo to the **Log Waste** tab and record what your kitchen threw away today.\n- Enter the ingredient name\n- Add the quantity and unit\n- Select a reason (overproduction, spoilage, trim, etc.)\n- Optionally add the estimated cost\n\n## Step 2: Review Your Dashboard\nAfter a few days of logging, the **Dashboard** tab shows:\n- Your total waste in weight and cost\n- Top 5 most wasted ingredients\n- Trends over time\n- Monthly cost projection\n\n## Step 3: Get AI Reuse Ideas\nThe **Reuse Ideas** tab suggests creative ways to use ingredients you're wasting.\nClick "Generate Suggestions" to get AI-powered reuse ideas.\n\n## Tips\n- Log waste at the end of every shift\n- Be honest — visibility is the first step to reduction\n- Industry average waste is 4-10% of food purchases\n- Use the "Quick Log" buttons for your most common items`,
    },
    {
      guideKey: "kitchen_copilot",
      title: "Getting Started with Kitchen Copilot",
      content: `# Getting Started with Kitchen Copilot\n\n## Step 1: Enter Expected Covers\nTell the system how many guests you expect tonight.\nThis drives the quantity calculations for your prep list.\n\n## Step 2: Review Your Prep Plan\nThe system generates a prioritised task list based on your recipes:\n- **Start First** — high-impact ingredients used across many dishes\n- **Next Up** — medium priority prep tasks\n- **Can Wait** — lower priority items that can be prepped later\n\n## Step 3: Track Progress\nCheck off tasks as your team completes them.\nAssign tasks to team members by clicking "Assign".\n\n## Step 4: Check Cross-Usage\nThe **Cross-Usage** tab shows which ingredients appear in the most dishes.\nPrep these first — if they run out, multiple dishes are affected.\n\n## Step 5: End Your Session\nAt the end of service, enter actual covers served.\nThis data helps improve future prep planning.\n\n## Tips\n- Start your prep session first thing every morning\n- Use the High-Impact tab to identify your most complex dishes\n- Check the History tab to spot patterns over time`,
    },
    {
      guideKey: "menu_intelligence",
      title: "Getting Started with Menu Intelligence",
      content: `# Getting Started with Menu Intelligence\n\n## Step 1: Add Your Menu Items\nGo to **Menu Items** and click "Add Menu Item".\nEnter each dish with its selling price and all ingredients with costs.\n\n## Step 2: Enter Ingredient Costs\nFor each menu item, add ingredients with:\n- Quantity and unit\n- Unit cost (what you pay per kg/L/each)\n- Yield percentage (to account for trim/waste)\n\nThe system automatically calculates food cost and contribution margin.\n\n## Step 3: Add Sales Data\nEnter units sold per item for the analysis period.\nYou can enter this manually or upload from your POS system.\n\n## Step 4: View the Engineering Matrix\nThe **Matrix** tab plots every dish by profitability vs popularity:\n- **Stars** — High profit, high sales. Protect these.\n- **Plowhorses** — Low profit, high sales. Optimise costs.\n- **Puzzles** — High profit, low sales. Promote them.\n- **Dogs** — Low profit, low sales. Replace them.\n\n## Step 5: Take Action\n- For **Dogs**: Click "Generate Replacement" to create a better recipe\n- For **Plowhorses**: Review ingredients to reduce food cost\n- For **Puzzles**: Improve descriptions and staff recommendations\n- Set food cost targets per category in **Category Settings**\n\n## Tips\n- Update sales data weekly for accurate classifications\n- A 1% food cost reduction across the menu can save thousands per year\n- Watch for items flagged with waste impact — they cost you twice`,
    },
  ];

  for (const g of defaultGuides) {
    const existing = await db.select().from(guide).where(eq(guide.guideKey, g.guideKey)).limit(1);
    if (existing.length === 0) {
      await db.insert(guide).values(g);
      console.log(`  Seeded guide: ${g.guideKey}`);
    } else {
      console.log(`  Guide ${g.guideKey} already exists, skipping`);
    }
  }

  console.log("Seed complete!");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
