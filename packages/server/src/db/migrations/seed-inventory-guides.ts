/**
 * Migration: Seed inventory tab guide content into the guides table.
 *
 * Creates 7 guide entries (one per inventory tab) with markdown content
 * matching the Intelligence module guide pattern.
 *
 * Run: npx tsx src/db/migrations/seed-inventory-guides.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

import { db } from "../index.js";
import { sql } from "drizzle-orm";

const guides: Array<{ key: string; title: string; content: string }> = [
  {
    key: "inventory_dashboard",
    title: "Dashboard Guide",
    content: `# Dashboard

Your inventory at a glance — stock health, alerts, and setup progress.

## Why this matters

The Dashboard gives you a real-time snapshot of your location's inventory health. You can see what's running low, what's critical, and whether your stock counts are up to date — all in one place. If your location still needs setup, the progress checklist at the top guides you through each step.

## How to use

1. **Select your location** from the dropdown at the top of the page
2. **Check the stock status cards** — green means healthy, amber means low, red means critical
3. **Follow the Setup Progress card** if your location still needs activation or an opening count
4. **Review the inventory value** breakdown by category to understand where your money sits
5. **Click into any low or critical item** to see its details and par level

## Pro tips

- Items show as **Low** when they drop below 75% of their par level, and **Critical** below 25%
- The dashboard refreshes each time you navigate to it — you're always seeing current data
- **Org admins** see a summary of all locations. Click any location row to drill into its details
`,
  },
  {
    key: "inventory_setup",
    title: "Setup Guide",
    content: `# Setup

Set up your location — activate items and complete your opening inventory count.

## Why this matters

Before your location can start tracking inventory, you need to tell the system what you carry and how much you have. The Setup tab walks you through activating items from the master catalogue and running your first stock count. This only needs to be done once per location.

## How to use

1. **Start with the Activation Wizard** — browse the catalogue and toggle on every item your location carries
2. **Use "Activate All"** on a category to quickly enable an entire group, then toggle off the few you don't carry
3. **Use "Copy from Location"** if another location is already set up — start with their item list
4. **Scroll to Opening Inventory** once items are activated
5. **Tap "Start Opening Inventory"** to begin your first count — count every item, category by category
6. **Submit** when all categories are counted — the system records your baseline and marks your location as active

## Pro tips

- You don't need to activate everything at once — you can come back and add more items later
- The opening count is **different from a regular stock take** — it sets your baseline with no variance to calculate yet
- After the opening count is complete, your **Dashboard will light up** with real data
`,
  },
  {
    key: "inventory_stock_take",
    title: "Stock Take Guide",
    content: `# Stock Take

Count your stock — run full inventory counts or quick cycle counts by category.

## Why this matters

A stock take is how you keep your inventory accurate. Walk around your location, count what's on the shelves and in the cool room, and the system calculates variance against what it expected. Regular counts catch shrinkage, spoilage, and ordering errors before they become problems.

## How to use

1. **Choose "Full Inventory"** to count everything, or **"Cycle Count"** to count specific categories
2. **Claim a category** to start counting — this lets other staff know you're handling that section
3. **Enter the quantity** you see for each item using the keypad
4. **Tap "+"** if you find an item not in the catalogue — it will be flagged for HQ review
5. **Submit each category** when you've counted every item in it
6. **Hit "Submit for Review"** when all categories are done — this sends it to HQ for approval

## Pro tips

- Use **"Copy Last Count"** to pre-fill quantities from your previous session — then adjust what's changed
- **Multiple staff** can count different categories at the same time — claim yours so others don't duplicate work
- **Count what you actually see** — don't guess. Variance is how the system learns
`,
  },
  {
    key: "inventory_review",
    title: "Review Guide (HQ)",
    content: `# Review

HQ review queue — approve, flag, or return stock take sessions from your locations.

## Why this matters

Every stock take goes through HQ review before it becomes official. This ensures data quality across all your locations. You can approve clean counts, flag suspicious variances for recount, or reject entire sessions with a written reason. This is your quality gate.

## How to use

1. **Pending sessions** appear in the queue sorted by submission date — oldest first
2. **Click into a session** to see the full breakdown: categories, line items, and variance
3. **Check for large variances** — these are highlighted automatically
4. **Approve** the session if the numbers look right
5. **Flag specific categories** with a reason if something looks off — the location will recount those categories

## Pro tips

- A variance **under 5%** is normal for most categories — investigate anything over 10%
- **Flagging is better than rejecting** — it tells the location exactly which categories to recount
- **Approved sessions** update stock levels immediately
`,
  },
  {
    key: "inventory_ingredients",
    title: "Catalogue Guide",
    content: `# Catalogue

Master catalogue — manage all items, categories, allergens, and supplier links.

## Why this matters

The Catalogue is the master list of everything your organisation tracks. Kitchen ingredients, front-of-house consumables, and operational supplies all live here. Every location draws from this shared catalogue — when you add an item here, it becomes available for all locations to activate.

## How to use

1. **Use the type tabs** (Kitchen, FOH, Operational) to filter items by type
2. **Click any row** to expand it and see cross-location stock levels
3. **Click the edit icon** to update details, allergen flags, or supplier links
4. **Add a new item** with the "+" button — choose the correct item type to set the default FIFO mode
5. **Set allergen flags carefully** — these display across all locations

## Pro tips

- **Kitchen items** always use FIFO (first in, first out). **FOH items** use FIFO for perishables only. **Operational supplies** never use FIFO
- The **category filter adjusts** based on item type — Kitchen items can't be filed under "Cleaning"
- If a location needs a niche item, they can **request it during a stock take** — it appears in the Requests tab
`,
  },
  {
    key: "inventory_suppliers",
    title: "Suppliers Guide",
    content: `# Suppliers

Manage your suppliers — contacts, delivery schedules, payment terms, and location assignments.

## Why this matters

Suppliers are linked to your items so you can track costs, lead times, and ordering methods. When you assign a supplier to an item, you're recording who you buy it from and at what price. This data feeds into purchase orders and cost analysis as the system grows.

## How to use

1. **Add a new supplier** with their contact details, delivery days, and payment terms
2. **Assign suppliers to locations** — not every supplier delivers to every location
3. **Link suppliers to items** in the Catalogue tab (edit an item, then manage its suppliers)
4. **Mark one supplier as "Preferred"** per item — this is the default for purchase orders

## Pro tips

- **Lead time matters** — it tells the system how early to suggest a reorder
- **Record the ordering method** (portal, email, phone) so any staff member can place an order
- **Keep supplier notes updated** — "Volume discounts on orders over $500" is the kind of detail that saves money
`,
  },
  {
    key: "inventory_requests",
    title: "Item Requests Guide (HQ)",
    content: `# Item Requests

Review item requests — approve or reject new items submitted by location staff.

## Why this matters

When location staff find items during a stock take that aren't in the catalogue, they can submit a request. This tab shows all pending requests. You decide whether to approve them (adding them to the master catalogue for all locations) or reject them with a reason.

## How to use

1. **Review each pending request** — check the item name, type, category, and which location submitted it
2. **To approve:** confirm the category and unit are correct, then click Approve — the item is added to the master catalogue instantly
3. **To reject:** click Reject, enter a reason (e.g., "Already exists as Olive Oil — Extra Virgin"), and submit
4. **The requesting location** sees your approval or rejection with your notes

## Pro tips

- **Check for duplicates** before approving — staff might submit "EVOO" when "Extra Virgin Olive Oil" already exists
- **Approved items** are automatically activated at the requesting location
- **Rejected requests** don't disappear — the location can see the reason and resubmit with corrections
`,
  },
];

async function seed() {
  console.log("Seeding inventory guide content...\n");

  for (const guide of guides) {
    await db.execute(sql`
      INSERT INTO guide (guide_key, title, content, created_dttm, updated_dttm)
      VALUES (${guide.key}, ${guide.title}, ${guide.content}, now(), now())
      ON CONFLICT (guide_key) DO UPDATE SET
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        updated_dttm = now()
    `);
    console.log(`  ✓ ${guide.key} — ${guide.title}`);
  }

  console.log(`\nSeeded ${guides.length} inventory guides.`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
