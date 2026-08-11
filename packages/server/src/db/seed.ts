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
const { applyEnvPrefix } = await import("../utils/envShim.js");
applyEnvPrefix();

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

  // Recipe-lab prompts (recipePrompt, patisseriePrompt, spiritsPrompt,
  // recipeRefinementPrompt) intentionally do NOT seed from disk. As of Phase
  // 8 they live in the database only and are authored through the admin UI
  // (Settings → Mobile → Prompts). Fresh deploys create them via that UI.

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
    // Inventory system permissions
    { permissionKey: "inventory:count", permissionDescription: "Count items during stock take sessions at assigned location" },
    { permissionKey: "inventory:manage", permissionDescription: "Open stock take sessions, set par levels, manage ingredient catalog" },
    { permissionKey: "inventory:transfer", permissionDescription: "Initiate and confirm inventory transfers between locations" },
    { permissionKey: "inventory:hq", permissionDescription: "HQ dashboard, approve/flag stock takes, cross-location oversight" },
    // Purchasing & Receiving permissions
    { permissionKey: "purchasing:draft", permissionDescription: "Create and edit draft purchase orders" },
    { permissionKey: "purchasing:submit", permissionDescription: "Submit POs for approval or send directly to supplier" },
    { permissionKey: "purchasing:approve", permissionDescription: "Approve or reject purchase orders above spend threshold (HQ only)" },
    { permissionKey: "purchasing:receive", permissionDescription: "Start receiving sessions and confirm delivery receipt" },
    { permissionKey: "purchasing:credit", permissionDescription: "Log credit notes against delivery discrepancies" },
    // Kitchen Operations module permissions (gate the Menu & Costing, Waste, and Prep modules)
    { permissionKey: "menu:read", permissionDescription: "View Menu & Costing — menu engineering, food cost %, and P&L per item" },
    { permissionKey: "waste:read", permissionDescription: "View Waste analytics and log wastage" },
    { permissionKey: "prep:manage", permissionDescription: "Create and manage Prep (mise en place) sessions and tasks" },
    // The Brain — per-user AI memory (docs/specs/brain-memory.md)
    { permissionKey: "brain:read", permissionDescription: "View Your Brain — the memories CulinAIre has captured for you" },
    { permissionKey: "brain:manage", permissionDescription: "Delete and correct Brain memories (own memories; org admins also manage org-shared memories)" },
    // Compliance Vault — staff document tracking and expiry
    { permissionKey: "compliance:read-own", permissionDescription: "View and upload your own compliance documents" },
    { permissionKey: "compliance:read-all", permissionDescription: "View compliance documents for all staff at your venue" },
    { permissionKey: "compliance:verify", permissionDescription: "Approve or reject uploaded compliance documents" },
    { permissionKey: "compliance:manage-rules", permissionDescription: "Manage expiry rules and organisation document requirements" },
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
      "inventory:count", "inventory:manage", "inventory:transfer", "inventory:hq",
      "purchasing:draft", "purchasing:submit", "purchasing:approve", "purchasing:receive", "purchasing:credit",
      "menu:read", "waste:read", "prep:manage",
      "brain:read", "brain:manage",
      "compliance:read-own", "compliance:read-all", "compliance:verify", "compliance:manage-rules",
    ],
    // Default tiers are solo operators (chef + owner in one) — they keep full module
    // access. Staff differentiation (BOH/FOH) is done via custom roles that omit these.
    // brain:read/brain:manage are a consent baseline: any user whose chat turns are
    // captured must be able to view and delete their own memories.
    Subscriber: [
      "chat:access", "org:create-organisation", "inventory:count", "purchasing:draft", "purchasing:receive",
      "menu:read", "waste:read", "prep:manage",
      "brain:read", "brain:manage",
      "compliance:read-own",
    ],
    "Paid Subscriber": [
      "chat:access", "chat:unlimited", "org:create-organisation", "org:manage-organisation",
      "inventory:count", "inventory:manage", "inventory:transfer",
      "purchasing:draft", "purchasing:submit", "purchasing:receive", "purchasing:credit",
      "menu:read", "waste:read", "prep:manage",
      "brain:read", "brain:manage",
      "compliance:read-own", "compliance:read-all", "compliance:verify",
    ],
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
    // The Brain — all flags ship OFF; rollout flips them in order:
    // brain_enabled → brain_capture_enabled (corpus warms) → brain_recall_enabled.
    // Rollback is flags → "false" (instant, no deploy).
    { key: "brain_enabled", value: "false" },
    { key: "brain_capture_enabled", value: "false" },
    { key: "brain_recall_enabled", value: "false" },
    { key: "brain_nudges_enabled", value: "false" },
    // Balanced capture-time keep/drop gate for chat memories (deviation from
    // spec D10, pulled into Phase 1). OFF → raw capture, spec-faithful; ON →
    // noise turns (retrieval questions, chit-chat) never get stored.
    { key: "brain_distillation_enabled", value: "false" },
    // Distillation model — slug verified live (anthropic/claude-haiku-4-5).
    { key: "brain_distillation_model", value: "anthropic/claude-haiku-4-5" },
    // Recall ranking weights (Phase 3 T18) — configurable so they can be tuned
    // on real hit-rate data (fact_brain_recall) without a deploy. Defaults are
    // the shipped values, so recall is byte-identical until an admin changes them.
    { key: "brain_rank_similarity_weight", value: "0.7" },
    { key: "brain_rank_recency_weight", value: "0.2" },
    { key: "brain_rank_recency_halflife_days", value: "30" },
    // Compaction (Phase 3 T16) — folds a tenant's coldest memories into a digest
    // once they exceed the cap, soft-archiving the sources. Off by default; the
    // cap is data-gated (0 = disabled) — set it once fact_brain_corpus shows real
    // per-tenant sizes so recall's exact-scan stays fast without over-compacting.
    { key: "brain_compaction_enabled", value: "false" },
    { key: "brain_compaction_cap", value: "0" },
    // Proactive nudges (Phase 3 T17) — max NUDGE notifications per user per 7 days.
    // Gated by brain_nudges_enabled (off) + each user's brain_nudges_opt_in.
    { key: "brain_nudge_rate_limit", value: "2" },
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
    {
      guideKey: "purchasing_orders",
      title: "Purchase Orders Guide",
      content: `# Purchase Orders

Every order you place, from draft to delivered.

## Why this matters

A purchase order is the document you spend money against. It records what you asked for, what the supplier charged, and what actually turned up. When the numbers on this page and the numbers on the invoice disagree, this is where you find out why.

## How to use

1. **Filter by status** to find what you need — Draft, Pending, Sent, Receiving, Received, Cancelled
2. **Click any order** to expand it and see every line: ordered, received, cost, and line status
3. **New PO** builds an order by hand; **Reorder** on a past order clones it
4. **Send it** and the supplier gets an email with the order attached as a PDF
5. **Received orders** show who signed for the delivery and when, right above the lines

## Pro tips

- An order reads **Partial** only when goods are genuinely missing — short or rejected. A price change on a complete delivery stays **Received**
- The Cost column shows the ordered price, and **$17.50 → $21.00** when the price actually paid was different. That arrow is your invoice discrepancy, visible without opening anything
- Orders above your spend threshold route to **Approvals** instead of going straight out. Set that figure in Settings\``,
    },
    {
      guideKey: "purchasing_guides",
      title: "Order Guides Guide",
      content: `# Order Guides

The list you reorder from each week, one per supplier.

## Why this matters

Most kitchens order the same forty things from the same four suppliers every week. Hunting the full catalogue each time is slow and error-prone — you forget the flour and remember it on Saturday. An order guide is that weekly list, held ready, so you review and send instead of rebuilding it from scratch.

## How to use

1. **Name the guide** for what it is — "Weekly Dry Goods", "Tuesday Produce"
2. **Pick the supplier** it belongs to. One guide, one supplier — that's who the order goes to
3. **Create guide**, then add the items you buy from them regularly
4. **Ordering fills it to par automatically** — you review the quantities and send

## Pro tips

- Build one guide per supplier per delivery day. "Bidfood Tuesday" and "Bidfood Friday" are two different lists
- An item can sit in more than one guide. If two suppliers both sell your flour, put it in both and order from whoever's cheaper that week
- Keep guides tight. A guide with ninety items is a catalogue, and you're back to hunting\``,
    },
    {
      guideKey: "purchasing_suggestions",
      title: "Suggestions Guide",
      content: `# Order Suggestions

Everything below par, grouped by the supplier who sells it.

## Why this matters

This is order-to-par: the kitchen decides how much of a thing it wants on the shelf, and the system works out the difference. No guessing, no "we always order six". If par is 25 kg and you have 16.8 kg, you need 8.2 kg — and it tells you, priced, grouped by who to ring.

## How to use

1. **Read the header** — items below par and the estimated total spend
2. **Each block is one supplier.** On hand, par, suggested quantity and estimated cost, per line
3. **Refresh** after a stock take or a delivery so the numbers reflect what's actually there
4. **Take the list to a New PO** — the suggestion is the starting point, not the order

## Pro tips

- Suggestions round up to whole packs. You cannot buy 1.4 bags of flour, so it asks for 2
- If a supplier has a minimum order, ordering below it shows an amber warning — it warns, it never blocks. Under-order deliberately if you want to
- An item with no par set never appears here. If something keeps running out, set its par in the Catalogue
- Items land under **Unassigned** when they have no preferred supplier. Set one on the item's supplier row\``,
    },
    {
      guideKey: "purchasing_receive",
      title: "Receiving Guide",
      content: `# Receive Deliveries

Check the delivery against the order, at the door.

## Why this matters

Receiving is the moment stock becomes real and money becomes committed. It's also the only moment you can catch a short delivery or a price rise — once the driver leaves, you're arguing from memory. Two minutes here is worth an hour of invoice reconciliation later.

## How to use

1. **Open the delivery** from the list — supplier, item count, value, and who ordered it
2. **Every line starts as fully received.** You only touch the ones that are wrong
3. **All Good** leaves it. **Short** takes the quantity that actually arrived. **Reject** takes none and asks why. **Price Change** records what they actually charged
4. **Confirm Receipt** when the checklist matches the pallet

## Pro tips

- Confirm posts everything at once: stock on hand, a dated FIFO batch, and a recalculated weighted average cost. It is all-or-nothing — nothing lands until you confirm
- Deliveries convert to your kitchen unit on the way in. Four bags of flour becomes 50 kg of stock, and the cost per bag becomes cost per kg
- The back arrow **cancels** the receiving session and returns the order to Sent. It does not quietly save your progress
- A rejection or a price change over 5% pages HQ automatically. You don't need to chase anyone\``,
    },
    {
      guideKey: "purchasing_suppliers",
      title: "Suppliers Guide",
      content: `# Suppliers

Who you buy from, and what they charge.

## Why this matters

Supplier records carry the details that make ordering work without a phone call: where the order goes, what a case costs, and how little they'll deliver. Get them right once and every order after that is faster.

## How to use

1. **Add** a supplier with their contact and ordering method — email orders go out automatically
2. **Click a supplier** to expand their details and the locations they deliver to
3. **Link items to suppliers** from the Catalogue, on each item's Suppliers row
4. **Set the price and the minimum** on that row — it's the only place either can be set

## Pro tips

- The star marks the **preferred** supplier. That's the one Suggestions groups the item under, and the one whose price flows into costing
- The price shown is what they invoice you: **$15.88 /bag** where the item has packaging, **$3.80 /kg** where you buy it loose
- The minimum is counted in **packs**, not kilos. "min 3 bag" means three bags, not three kilograms
- A supplier with no contact email can still hold prices — you just have to place the order yourself\``,
    },
    {
      guideKey: "purchasing_approvals",
      title: "Approvals Guide (HQ)",
      content: `# Approvals

Orders that need a second pair of eyes before they go out.

## Why this matters

A spend threshold is the difference between a kitchen that can order what it needs and a kitchen that can accidentally order $8,000 of scallops. Orders under the threshold go straight to the supplier; anything above waits here for someone accountable.

## How to use

1. **Review the queue** — each order shows the supplier, the location, the value, and how long it's been waiting
2. **Expand it** to see exactly what was ordered before you decide
3. **Approve** and it sends immediately. **Reject** and it returns to draft with your reason attached
4. **Watch the waiting time** — it turns amber past 24 hours and red past 48

## Pro tips

- Rejecting isn't a dead end. The order goes back to the chef as a draft with your note, so they can trim it and resubmit
- The threshold is per organisation, not per location. Change it in Settings
- If nothing is queued, nobody is blocked. An empty Approvals tab is a good sign\``,
    },
    {
      guideKey: "purchasing_settings",
      title: "Purchasing Settings Guide (HQ)",
      content: `# Purchasing Settings

The spend threshold that decides what needs approval.

## Why this matters

One number controls how much autonomy your kitchens have. Set it too low and you approve orders all day; set it too high and a mistake ships before anyone sees it. It should sit just above a normal weekly order for your busiest site.

## How to use

1. **Set the threshold** in dollars
2. **Save.** It applies to every order submitted from that moment on
3. Orders **at or under** the threshold send straight to the supplier
4. Orders **above** it wait in Approvals until an HQ admin decides

## Pro tips

- Look at a few weeks of real orders before choosing. Pick a figure that catches the unusual, not the routine
- Changing the threshold doesn't touch orders already waiting for approval
- A threshold of zero sends everything to Approvals. That's a valid choice for a new site, and an exhausting one for an established kitchen\``,
    },
    {
      guideKey: "inventory_areas",
      title: "Storage Areas Guide",
      content: `# Storage Areas

The shelves you actually walk when you count.

## Why this matters

A stock take is a physical walk: cool room, dry store, back bar. Counting in the same order as you walk is faster and you miss less. Areas organise that walk — but stock still belongs to the whole site. Moving a case from the store to the bar changes where it sits, never how much you have.

## How to use

1. **Add an area** for each place you actually count — "Dry Storage", "Cool Room", "Back Bar"
2. **Assign items** to the area they live in
3. **Stock takes follow your areas**, so counting matches the route you walk
4. **Move Between Areas** (under Transfers) records a shelf-to-shelf move within the site

## Pro tips

- Name areas after physical places, not categories. "Cool Room" beats "Dairy" — you walk to a cool room, not to a dairy
- An area move is not a loss and not a transfer between sites. Your total on hand is unchanged
- Items don't need an area. Anything unassigned still counts, it just falls at the end of the walk\``,
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
