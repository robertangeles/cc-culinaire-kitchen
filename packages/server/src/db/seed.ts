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
    { key: "web_search_model", value: "perplexity/sonar-pro" },
    { key: "image_generation_enabled", value: "false" },
    { key: "image_generation_model", value: "google/gemini-2.5-flash-image" },
    { key: "vector_search_enabled", value: "false" },
    { key: "guest_session_idle_hours", value: "24" },
    { key: "default_guest_sessions", value: "10" },
    { key: "default_registered_sessions", value: "10" },
    { key: "recipe_archive_retention_days", value: "30" },
    { key: "recipes_per_page", value: "20" },
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
      title: "Waste Intelligence — Your Guide",
      content: `# Waste Intelligence

**Track it. See it. Reduce it.**

Waste Intelligence helps you understand exactly where your kitchen's money goes — and how to keep more of it. The average restaurant wastes 4–10% of purchased food. Most kitchens don't track it at all. You're about to change that.

---

## Your first 5 minutes

### 1. Open the Log Waste tab
This is where everything starts. Tap the ingredient name, enter how much was thrown away, and hit **Log Waste**. That's it — three taps.

**Pro tip:** After your first few entries, you'll see **Quick Log** buttons appear for your most common items. One tap to log them next time.

### 2. Add a reason (optional but powerful)
Was it overproduction? Spoilage? Trim? Plate waste? Selecting a reason helps the dashboard show you *why* your kitchen wastes — not just *what*.

### 3. Add a cost estimate (optional)
If you know what the ingredient costs per kg, add it. The dashboard will calculate your waste in dollars, not just kilograms. This is what gets attention in budget meetings.

---

## After a few days of logging

### 4. Check your Dashboard
Switch to the **Dashboard** tab. You'll see:

- **Total waste** this period — in weight and cost
- **Top 5 ingredients** you waste most (by cost and by weight)
- **Trend line** — are you getting better or worse?
- **Monthly projection** — "At this rate, your kitchen wastes ~$X per month"

The industry benchmark is 4–10% of food purchases. Where do you sit?

### 5. Explore Reuse Ideas
The **Reuse Ideas** tab uses AI to suggest practical ways to repurpose what you're wasting:

- Mushroom trim → rich stock for risotto base
- Overripe tomatoes → roasted tomato sauce
- Herb stems → compound butter or infused oil

Click **Generate Recipe** on any suggestion to create a full recipe in the Recipe Lab.

---

## Making it a habit

The single most important thing: **log waste at the end of every shift.** The act of logging alone reduces waste by 10–15%. Your team becomes conscious of what they're throwing away.

### For teams
If you're part of an organisation, switch to **Team Data** to see waste across your whole kitchen — not just your own entries. Organisation admins can view and manage all team members' logs.

### Weekly digest
Every Sunday evening, you'll receive an email summary of your week's waste — total cost, top items, and trend compared to last week. No action needed — it arrives automatically.

---

## Quick reference

| Tab | What it does |
|-----|-------------|
| **Log Waste** | Record what was thrown away |
| **Dashboard** | See trends, costs, and top waste items |
| **Reuse Ideas** | AI suggestions to repurpose waste ingredients |`,
    },
    {
      guideKey: "kitchen_copilot",
      title: "Kitchen Copilot — Your Guide",
      content: `# Kitchen Copilot

**Your morning prep plan. Prioritised. Sequenced. Tracked.**

Kitchen Copilot takes your recipe library and turns it into a daily prep plan — prioritised by what matters most. No more guessing what to prep first. No more running out mid-service.

---

## Starting your day

### 1. Enter expected covers
When you arrive in the morning, tell the Copilot how many guests you're expecting tonight. This number drives the quantity calculations for everything.

Don't overthink it — your best estimate is fine. You can always adjust.

### 2. Review your prep plan
The Copilot generates a prioritised task list in three tiers:

- **Start With These** — High-impact ingredients that appear across many dishes. If these run out, multiple dishes go down.
- **Next Up** — Important but less critical. Prep these once the high-priority work is done.
- **Can Wait** — Lower priority items. Prep these if time allows, or defer to tomorrow.

Each task shows the ingredient, quantity needed, and estimated prep time.

### 3. Assign and track
Click **Assign** on any task to assign it to a team member by name. As your team works through the list, check off completed tasks. The progress bar updates in real time.

---

## Understanding your kitchen better

### 4. Check Cross-Usage
The **Cross-Usage** tab reveals which ingredients appear in the most dishes on your menu. This is gold:

- **Shallots** appear in 7 dishes? Prep all your shallot work in one batch.
- **Chicken stock** feeds 5 dishes? Make it first — everything else depends on it.

Ingredients shared across 3+ dishes are highlighted. These are your highest-leverage prep tasks.

### 5. Identify high-impact dishes
The **High-Impact** tab ranks your dishes by prep complexity — ingredient count, step count, and technique difficulty.

Dishes with a Menu Intelligence classification badge (Star, Plowhorse, Puzzle, Dog) show their profitability ranking too. Your Stars deserve the most prep attention.

### 6. End your session
At the end of service, click **End Session** and enter actual covers served. Over time, this data helps you spot patterns — do you consistently over-prep on Tuesdays? Under-prep on Fridays?

---

## For teams

Switch to **Team Data** to see prep activity across your whole kitchen. Organisation admins can view all team members' sessions and task completion rates.

---

## Quick reference

| Tab | What it does |
|-----|-------------|
| **Today's Prep** | Prioritised task list with progress tracking |
| **Cross-Usage** | Ingredients ranked by how many dishes use them |
| **High-Impact** | Your most complex dishes ranked |
| **History** | Past prep sessions with completion stats |

---

## Tips from the pass

- Start your session **before** you open the cool room. Let the plan guide your morning, not your habits.
- Prep shared ingredients **first, together** — don't let each station prep independently.
- If you skip a task, mark it as **Skipped** — this data matters for future planning.
- Check the **waste alert banner** at the top of your prep plan. It flags ingredients you've been wasting recently.`,
    },
    {
      guideKey: "menu_intelligence",
      title: "Menu Intelligence — Your Guide",
      content: `# Menu Intelligence

**Know your Stars. Fix your Dogs. Protect your margin.**

Menu Intelligence applies the industry-standard menu engineering framework to your menu. Every dish gets classified by two dimensions: how profitable it is and how popular it is. The result tells you exactly where to focus.

---

## Building your menu

### 1. Add your menu items
Go to the **Menu Items** tab and click **Add Menu Item**. For each dish, enter:

- **Name** and **category** (starters, mains, desserts, etc.)
- **Selling price** — what the guest pays

### 2. Add ingredient costs
This is where the magic happens. For each menu item, add every ingredient with:

- **Quantity** and **unit** (200g, 500ml, 2 each)
- **Unit cost** — what you pay your supplier per kg, litre, or unit
- **Yield %** — accounts for trim and waste (e.g., whole fish at 45% yield)

The system calculates your **food cost**, **food cost percentage**, and **contribution margin** automatically. No spreadsheets needed.

### 3. Enter sales data
Add **units sold** per item for your analysis period. This is your popularity data. You can enter it:

- **Manually** — from your POS reports or till readings
- **Via CSV upload** — export from your POS system

---

## Reading the matrix

### 4. View the Engineering Matrix
The **Matrix** tab is the heart of Menu Intelligence. Every dish is plotted on a scatter chart:

- **X axis** — Popularity (menu mix percentage)
- **Y axis** — Profitability (contribution margin)

This creates four quadrants:

**Stars** ⭐ — *Top right.* High profit, high popularity. These are your best dishes. Protect them. Feature them. Never let them run out during service.

**Plowhorses** 🐴 — *Bottom right.* Guests love them but they don't make you money. The fix: swap an expensive ingredient for a cheaper one, reduce portion slightly, or raise the price by $2.

**Puzzles** 🧩 — *Top left.* Great margins but nobody orders them. The fix: rename the dish, rewrite the description, move it to a more visible menu position, or have staff recommend it.

**Dogs** 🐕 — *Bottom left.* Low profit, low popularity. Candidates for removal. Click **Generate Replacement** to create a recipe targeting the Star quadrant.

### 5. Review your dashboard
The **Dashboard** tab gives you the big picture at a glance:

- Total items analysed
- Average food cost % across your menu
- Count per quadrant
- Highest and lowest margin items
- Items flagged with waste impact

---

## Taking action

### 6. Set category targets
In **Category Settings**, set your target food cost percentage per category. Items exceeding the target are flagged in red on the menu list.

Common benchmarks:
- **Starters:** 25–30%
- **Mains:** 28–35%
- **Desserts:** 20–28%
- **Beverages:** 15–22%

### 7. Replace your Dogs
When you identify a Dog, click **Generate Replacement**. CulinAIre creates a new recipe that:

- Targets your category's food cost percentage
- Matches your cuisine identity and brand voice
- Uses ingredients you already stock
- Aims for Star classification from day one

---

## The bottom line

A 1% reduction in food cost across your entire menu can save thousands per year. Menu Intelligence shows you exactly where that 1% is hiding.

---

## Quick reference

| Tab | What it does |
|-----|-------------|
| **Dashboard** | Overview of menu performance |
| **Menu Items** | Add, edit, and cost your dishes |
| **Matrix** | Visual engineering analysis |
| **Category Settings** | Set food cost targets per category |

---

## Tips from the pass

- Update sales data **weekly** for the most accurate classifications.
- Watch for dishes flagged with both **Dog** and **high waste** — they cost you twice.
- Don't remove a Puzzle without trying to promote it first. Rename it, reposition it on the menu, or train your team to recommend it.
- Your Stars are non-negotiable. If a Star ingredient's price spikes, absorb the cost — don't remove the dish.`,
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
