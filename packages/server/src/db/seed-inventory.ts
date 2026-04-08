/**
 * @module db/seed-inventory
 *
 * Seeds realistic Australian demo data for the inventory system:
 *   - 5 Melbourne-area suppliers with full operational fields
 *   - ~30 catalog items across 6 categories with AUD prices
 *   - Supplier-item relationships (ingredient_supplier junction)
 *   - Supplier-location assignments (all suppliers org-wide)
 *   - Location-ingredient activation with par levels
 *   - Stock levels at varied percentages for dashboard alerts
 *
 * Clears existing inventory data first (in FK-safe order),
 * then inserts fresh demo data. Idempotent — safe to re-run.
 *
 * Usage:
 *   cd packages/server && npx tsx src/db/seed-inventory.ts
 */

import { config } from "dotenv";
config({ path: "../../.env" });

const { db } = await import("./index.js");
const {
  organisation,
  storeLocation,
  ingredient,
  supplier,
  supplierLocation,
  ingredientSupplier,
  locationIngredient,
  stockLevel,
} = await import("./schema.js");
const { eq, sql } = await import("drizzle-orm");

// ─── Resolve org + locations dynamically ────────────────────────────

const [org] = await db
  .select()
  .from(organisation)
  .where(eq(organisation.organisationName, "Comfort Spoon Co."))
  .limit(1);

if (!org) {
  console.error("Organisation 'Comfort Spoon Co.' not found. Seed the org first.");
  process.exit(1);
}

const orgId = org.organisationId;
const locations = await db
  .select()
  .from(storeLocation)
  .where(eq(storeLocation.organisationId, orgId));

if (locations.length === 0) {
  console.error("No store locations found for Comfort Spoon Co.");
  process.exit(1);
}

console.log(`Found org: ${org.organisationName} (ID: ${orgId})`);
console.log(`Found ${locations.length} location(s): ${locations.map((l) => l.locationName).join(", ")}`);

// ─── Clear existing inventory data (FK-safe order) ─────────────────

console.log("\nClearing existing inventory data...");

// Use raw SQL to truncate in FK-safe order (scoped to this org's data)
await db.execute(sql`DELETE FROM ingredient_supplier WHERE ingredient_id IN (SELECT ingredient_id FROM ingredient WHERE organisation_id = ${orgId})`);
await db.execute(sql`DELETE FROM supplier_location WHERE supplier_id IN (SELECT supplier_id FROM supplier WHERE organisation_id = ${orgId})`);
await db.execute(sql`DELETE FROM stock_take_line WHERE category_id IN (SELECT category_id FROM stock_take_category WHERE session_id IN (SELECT session_id FROM stock_take_session WHERE store_location_id IN (SELECT store_location_id FROM store_location WHERE organisation_id = ${orgId})))`);
await db.execute(sql`DELETE FROM stock_take_category WHERE session_id IN (SELECT session_id FROM stock_take_session WHERE store_location_id IN (SELECT store_location_id FROM store_location WHERE organisation_id = ${orgId}))`);
await db.execute(sql`DELETE FROM stock_take_session WHERE store_location_id IN (SELECT store_location_id FROM store_location WHERE organisation_id = ${orgId})`);
await db.execute(sql`DELETE FROM stock_level WHERE ingredient_id IN (SELECT ingredient_id FROM ingredient WHERE organisation_id = ${orgId})`);
await db.execute(sql`DELETE FROM unit_conversion WHERE ingredient_id IN (SELECT ingredient_id FROM ingredient WHERE organisation_id = ${orgId})`);
await db.execute(sql`DELETE FROM location_ingredient WHERE ingredient_id IN (SELECT ingredient_id FROM ingredient WHERE organisation_id = ${orgId})`);
await db.delete(ingredient).where(eq(ingredient.organisationId, orgId));
await db.delete(supplier).where(eq(supplier.organisationId, orgId));

console.log("Cleared all inventory data for org.");

// ─── Seed Suppliers ─────────────────────────────────────────────────

console.log("\nSeeding suppliers...");

const suppliersData = [
  {
    supplierName: "Bidfood Melbourne",
    contactName: "Sarah Chen",
    contactEmail: "sarah.chen@bidfood.com.au",
    contactPhone: "03 9404 7100",
    supplierCategory: "multi",
    paymentTerms: "net_30",
    orderingMethod: "portal",
    deliveryDays: "mon,wed,fri",
    currency: "AUD",
    leadTimeDays: 2,
    minimumOrderValue: "200",
    notes: "Full-service foodservice distributor — proteins, dairy, dry goods, frozen. Account rep: Sarah Chen.",
  },
  {
    supplierName: "PFD Food Services",
    contactName: "Marcus Rivera",
    contactEmail: "marcus.r@pfd.com.au",
    contactPhone: "03 9357 0700",
    supplierCategory: "food",
    paymentTerms: "net_14",
    orderingMethod: "email",
    deliveryDays: "mon,tue,thu,fri",
    currency: "AUD",
    leadTimeDays: 1,
    minimumOrderValue: "150",
    notes: "Specialist in premium proteins and dairy. Next-day delivery for orders placed before 2pm.",
  },
  {
    supplierName: "Conga Foods",
    contactName: "Luca Benedetti",
    contactEmail: "orders@congafoods.com.au",
    contactPhone: "03 9462 3800",
    supplierCategory: "food",
    paymentTerms: "net_7",
    orderingMethod: "phone",
    deliveryDays: "tue,thu",
    currency: "AUD",
    leadTimeDays: 1,
    minimumOrderValue: "100",
    notes: "Italian specialty — pasta, olive oil, parmesan, truffle products, cured meats. Family-run since 1968.",
  },
  {
    supplierName: "Paramount Liquor",
    contactName: "Jake Thomson",
    contactEmail: "jake.t@paramountliquor.com.au",
    contactPhone: "03 9339 2850",
    supplierCategory: "food",
    paymentTerms: "net_30",
    orderingMethod: "portal",
    deliveryDays: "wed",
    currency: "AUD",
    leadTimeDays: 3,
    minimumOrderValue: "300",
    notes: "Spirits, wine, beer for bar and cooking. Volume discounts on orders over $500.",
  },
  {
    supplierName: "Ecopack Australia",
    contactName: "Nina Patel",
    contactEmail: "sales@ecopack.com.au",
    contactPhone: "03 9555 1200",
    supplierCategory: "packaging",
    paymentTerms: "net_14",
    orderingMethod: "email",
    deliveryDays: "fri",
    currency: "AUD",
    leadTimeDays: 5,
    minimumOrderValue: "80",
    notes: "Sustainable takeaway packaging, paper bags, napkins, compostable containers. Carbon-neutral certified.",
  },
];

const insertedSuppliers: Record<string, string> = {}; // name → supplierId

for (const s of suppliersData) {
  const [row] = await db
    .insert(supplier)
    .values({ organisationId: orgId, ...s })
    .returning();
  insertedSuppliers[s.supplierName] = row.supplierId;
  console.log(`  Supplier: ${s.supplierName} (${row.supplierId})`);
}

// ─── Assign all suppliers to all locations (org-wide) ───────────────

console.log("\nAssigning suppliers to locations...");

for (const [name, supId] of Object.entries(insertedSuppliers)) {
  for (const loc of locations) {
    await db.insert(supplierLocation).values({
      supplierId: supId,
      storeLocationId: loc.storeLocationId,
    });
  }
  console.log(`  ${name} → ${locations.length} location(s)`);
}

// ─── Seed Catalog Items ─────────────────────────────────────────────

console.log("\nSeeding catalog items...");

interface CatalogItem {
  ingredientName: string;
  ingredientCategory: string;
  baseUnit: string;
  description: string;
  unitCost: string;
  parLevel: string;
  reorderQty: string;
  containsDairyInd?: boolean;
  containsGlutenInd?: boolean;
  containsNutsInd?: boolean;
  containsShellfishInd?: boolean;
  containsEggsInd?: boolean;
  isVegetarianInd?: boolean;
  suppliers: Array<{
    supplierName: string;
    costPerUnit: string;
    supplierItemCode: string;
    preferred: boolean;
  }>;
  /** Stock as fraction of par (0.0–1.0) per location, to create varied dashboard */
  stockFractions: number[];
}

const catalogItems: CatalogItem[] = [
  // ── Proteins ──
  {
    ingredientName: "Chicken Breast (free range)",
    ingredientCategory: "proteins",
    baseUnit: "kg",
    description: "Lilydale free range chicken breast, skin off. Avg 200g per piece.",
    unitCost: "12.50", parLevel: "20", reorderQty: "10",
    suppliers: [
      { supplierName: "PFD Food Services", costPerUnit: "12.50", supplierItemCode: "PFD-CB100", preferred: true },
      { supplierName: "Bidfood Melbourne", costPerUnit: "13.20", supplierItemCode: "BF-20145", preferred: false },
    ],
    stockFractions: [0.85, 0.70],
  },
  {
    ingredientName: "Wagyu Beef Striploin MB4+",
    ingredientCategory: "proteins",
    baseUnit: "kg",
    description: "Rangers Valley wagyu striploin, marble score 4+. Portion 250g.",
    unitCost: "85.00", parLevel: "8", reorderQty: "4",
    suppliers: [
      { supplierName: "PFD Food Services", costPerUnit: "85.00", supplierItemCode: "PFD-WS400", preferred: true },
    ],
    stockFractions: [0.50, 0.25], // low at loc 1, critical at loc 2
  },
  {
    ingredientName: "Atlantic Salmon Fillet",
    ingredientCategory: "proteins",
    baseUnit: "kg",
    description: "Huon Aquaculture Atlantic salmon, skin-on pin-boned fillet.",
    unitCost: "32.00", parLevel: "10", reorderQty: "5",
    containsShellfishInd: true,
    suppliers: [
      { supplierName: "PFD Food Services", costPerUnit: "32.00", supplierItemCode: "PFD-AS200", preferred: true },
      { supplierName: "Bidfood Melbourne", costPerUnit: "34.50", supplierItemCode: "BF-20290", preferred: false },
    ],
    stockFractions: [0.90, 0.80],
  },
  {
    ingredientName: "Lamb Rack (cap off)",
    ingredientCategory: "proteins",
    baseUnit: "kg",
    description: "Gippsland lamb rack, cap removed, frenched. 8 ribs per rack.",
    unitCost: "42.00", parLevel: "6", reorderQty: "3",
    suppliers: [
      { supplierName: "PFD Food Services", costPerUnit: "42.00", supplierItemCode: "PFD-LR300", preferred: true },
    ],
    stockFractions: [0.65, 0.55],
  },
  {
    ingredientName: "Pork Belly (skin on)",
    ingredientCategory: "proteins",
    baseUnit: "kg",
    description: "Free range pork belly, skin scored. For slow roasting or braising.",
    unitCost: "14.50", parLevel: "8", reorderQty: "5",
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "14.50", supplierItemCode: "BF-20180", preferred: true },
    ],
    stockFractions: [0.80, 0.90],
  },
  {
    ingredientName: "Tiger Prawns (U8)",
    ingredientCategory: "proteins",
    baseUnit: "kg",
    description: "Wild-caught tiger prawns, under 8 count per pound. Head-on, shell-on.",
    unitCost: "38.00", parLevel: "5", reorderQty: "3",
    containsShellfishInd: true,
    suppliers: [
      { supplierName: "PFD Food Services", costPerUnit: "38.00", supplierItemCode: "PFD-TP150", preferred: true },
    ],
    stockFractions: [0.60, 0.20], // critical at loc 2
  },

  // ── Dairy & Eggs ──
  {
    ingredientName: "Heavy Cream (35% fat)",
    ingredientCategory: "dairy",
    baseUnit: "L",
    description: "Bulla thickened cream 35% fat. For sauces, ganache, and whipping.",
    unitCost: "6.80", parLevel: "15", reorderQty: "8",
    containsDairyInd: true,
    suppliers: [
      { supplierName: "PFD Food Services", costPerUnit: "6.80", supplierItemCode: "PFD-HC050", preferred: true },
      { supplierName: "Bidfood Melbourne", costPerUnit: "7.20", supplierItemCode: "BF-30100", preferred: false },
    ],
    stockFractions: [0.75, 0.85],
  },
  {
    ingredientName: "Unsalted Butter",
    ingredientCategory: "dairy",
    baseUnit: "kg",
    description: "Pepe Saya cultured unsalted butter. 250g blocks.",
    unitCost: "14.00", parLevel: "10", reorderQty: "5",
    containsDairyInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "14.00", supplierItemCode: "BF-30120", preferred: true },
    ],
    stockFractions: [0.90, 0.45], // low at loc 2
  },
  {
    ingredientName: "Parmigiano Reggiano 24mo",
    ingredientCategory: "dairy",
    baseUnit: "kg",
    description: "DOP certified, aged 24 months. Wedge cut from wheel.",
    unitCost: "42.00", parLevel: "3", reorderQty: "2",
    containsDairyInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "42.00", supplierItemCode: "CG-PR240", preferred: true },
    ],
    stockFractions: [0.85, 0.70],
  },
  {
    ingredientName: "Fresh Mozzarella (fior di latte)",
    ingredientCategory: "dairy",
    baseUnit: "kg",
    description: "That's Amore fior di latte, hand-stretched. 125g balls.",
    unitCost: "18.00", parLevel: "4", reorderQty: "2",
    containsDairyInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "18.00", supplierItemCode: "CG-MZ100", preferred: true },
    ],
    stockFractions: [0.50, 0.80],
  },
  {
    ingredientName: "Free Range Eggs (700g dozen)",
    ingredientCategory: "dairy",
    baseUnit: "doz",
    description: "Pace Farm free range eggs, 700g carton (12 pack).",
    unitCost: "6.50", parLevel: "10", reorderQty: "5",
    containsEggsInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "6.50", supplierItemCode: "BF-30200", preferred: true },
    ],
    stockFractions: [0.80, 0.30], // critical at loc 2
  },

  // ── Produce ──
  {
    ingredientName: "Mixed Salad Leaves",
    ingredientCategory: "produce",
    baseUnit: "kg",
    description: "Premium mesclun mix — rocket, baby spinach, cos, radicchio.",
    unitCost: "16.00", parLevel: "5", reorderQty: "3",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "16.00", supplierItemCode: "BF-40100", preferred: true },
    ],
    stockFractions: [0.40, 0.60], // low at loc 1
  },
  {
    ingredientName: "Cherry Tomatoes (vine)",
    ingredientCategory: "produce",
    baseUnit: "kg",
    description: "Vine-ripened cherry tomatoes, Australian grown. 250g punnets.",
    unitCost: "8.50", parLevel: "4", reorderQty: "2",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "8.50", supplierItemCode: "BF-40120", preferred: true },
    ],
    stockFractions: [0.85, 0.90],
  },
  {
    ingredientName: "Avocado (Hass)",
    ingredientCategory: "produce",
    baseUnit: "each",
    description: "Hass avocado, ripe and ready. Avg 200g each.",
    unitCost: "2.80", parLevel: "20", reorderQty: "10",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "2.80", supplierItemCode: "BF-40130", preferred: true },
    ],
    stockFractions: [0.75, 0.85],
  },
  {
    ingredientName: "Lemon",
    ingredientCategory: "produce",
    baseUnit: "each",
    description: "Eureka lemons, Australian. For juice, zest, and garnish.",
    unitCost: "0.60", parLevel: "30", reorderQty: "15",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "0.60", supplierItemCode: "BF-40140", preferred: true },
    ],
    stockFractions: [0.90, 0.95],
  },
  {
    ingredientName: "Garlic (Australian)",
    ingredientCategory: "produce",
    baseUnit: "kg",
    description: "Australian white garlic, loose bulbs. Avg 50g per bulb.",
    unitCost: "22.00", parLevel: "2", reorderQty: "1",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "22.00", supplierItemCode: "BF-40150", preferred: true },
    ],
    stockFractions: [0.80, 0.70],
  },
  {
    ingredientName: "Brown Onion",
    ingredientCategory: "produce",
    baseUnit: "kg",
    description: "Brown onion, 10kg bag. Staple mirepoix base.",
    unitCost: "2.50", parLevel: "10", reorderQty: "5",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "2.50", supplierItemCode: "BF-40160", preferred: true },
    ],
    stockFractions: [0.85, 0.80],
  },
  {
    ingredientName: "Kipfler Potato",
    ingredientCategory: "produce",
    baseUnit: "kg",
    description: "Kipfler potatoes, washed. For roasting, salads, and confit.",
    unitCost: "4.80", parLevel: "15", reorderQty: "8",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "4.80", supplierItemCode: "BF-40170", preferred: true },
    ],
    stockFractions: [0.70, 0.55],
  },
  {
    ingredientName: "Fresh Basil",
    ingredientCategory: "produce",
    baseUnit: "bunch",
    description: "Sweet Genovese basil, hydroponically grown. Approx 30g bunch.",
    unitCost: "3.50", parLevel: "6", reorderQty: "3",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "3.50", supplierItemCode: "BF-40200", preferred: true },
    ],
    stockFractions: [0.35, 0.50], // low at loc 1
  },

  // ── Dry Goods & Pantry ──
  {
    ingredientName: "Arborio Rice",
    ingredientCategory: "dry_goods",
    baseUnit: "kg",
    description: "Riso Gallo Arborio rice for risotto. 1kg bags.",
    unitCost: "5.50", parLevel: "10", reorderQty: "5",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "5.50", supplierItemCode: "CG-DG100", preferred: true },
      { supplierName: "Bidfood Melbourne", costPerUnit: "6.00", supplierItemCode: "BF-50100", preferred: false },
    ],
    stockFractions: [0.80, 0.75],
  },
  {
    ingredientName: "Spaghetti (bronze die)",
    ingredientCategory: "dry_goods",
    baseUnit: "kg",
    description: "De Cecco spaghetti #12, bronze-die extruded. 500g packs.",
    unitCost: "4.80", parLevel: "8", reorderQty: "4",
    containsGlutenInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "4.80", supplierItemCode: "CG-PA100", preferred: true },
    ],
    stockFractions: [0.90, 0.85],
  },
  {
    ingredientName: "Extra Virgin Olive Oil",
    ingredientCategory: "dry_goods",
    baseUnit: "L",
    description: "Cobram Estate EVOO, first cold press. 3L tin.",
    unitCost: "14.00", parLevel: "10", reorderQty: "5",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "14.00", supplierItemCode: "CG-OO100", preferred: true },
    ],
    stockFractions: [0.70, 0.65],
  },
  {
    ingredientName: "Plain Flour",
    ingredientCategory: "dry_goods",
    baseUnit: "kg",
    description: "Lighthouse plain flour. 12.5kg sack.",
    unitCost: "1.80", parLevel: "15", reorderQty: "10",
    containsGlutenInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "1.80", supplierItemCode: "BF-50200", preferred: true },
    ],
    stockFractions: [0.85, 0.90],
  },
  {
    ingredientName: "Caster Sugar",
    ingredientCategory: "dry_goods",
    baseUnit: "kg",
    description: "CSR caster sugar. 15kg bag.",
    unitCost: "2.20", parLevel: "10", reorderQty: "5",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "2.20", supplierItemCode: "BF-50220", preferred: true },
    ],
    stockFractions: [0.80, 0.85],
  },
  {
    ingredientName: "San Marzano Tomatoes (tinned)",
    ingredientCategory: "dry_goods",
    baseUnit: "each",
    description: "DOP San Marzano whole peeled tomatoes. 400g tin.",
    unitCost: "4.50", parLevel: "12", reorderQty: "6",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "4.50", supplierItemCode: "CG-TM100", preferred: true },
    ],
    stockFractions: [0.60, 0.45], // low at both
  },
  {
    ingredientName: "Truffle Oil",
    ingredientCategory: "dry_goods",
    baseUnit: "L",
    description: "Sabatino Tartufi black truffle oil. 250ml bottle.",
    unitCost: "65.00", parLevel: "2", reorderQty: "1",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Conga Foods", costPerUnit: "65.00", supplierItemCode: "CG-TR100", preferred: true },
    ],
    stockFractions: [0.50, 0.15], // critical at loc 2
  },

  // ── Beverages ──
  {
    ingredientName: "Espresso Beans (house blend)",
    ingredientCategory: "beverages",
    baseUnit: "kg",
    description: "Market Lane house espresso blend. 1kg bags, roasted weekly.",
    unitCost: "35.00", parLevel: "5", reorderQty: "3",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "35.00", supplierItemCode: "BF-60100", preferred: true },
    ],
    stockFractions: [0.60, 0.40], // low at loc 2
  },
  {
    ingredientName: "Full Cream Milk",
    ingredientCategory: "beverages",
    baseUnit: "L",
    description: "Riverina Fresh full cream milk. 2L bottles.",
    unitCost: "1.80", parLevel: "20", reorderQty: "10",
    containsDairyInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "1.80", supplierItemCode: "BF-60120", preferred: true },
    ],
    stockFractions: [0.75, 0.80],
  },
  {
    ingredientName: "Sparkling Water (750ml)",
    ingredientCategory: "beverages",
    baseUnit: "each",
    description: "San Pellegrino sparkling mineral water. 750ml glass bottle.",
    unitCost: "3.20", parLevel: "24", reorderQty: "12",
    isVegetarianInd: true,
    suppliers: [
      { supplierName: "Bidfood Melbourne", costPerUnit: "3.20", supplierItemCode: "BF-60140", preferred: true },
    ],
    stockFractions: [0.85, 0.90],
  },
  {
    ingredientName: "House Red (Shiraz, Barossa)",
    ingredientCategory: "beverages",
    baseUnit: "each",
    description: "Penfolds Koonunga Hill Shiraz. 750ml bottle. For bar and cooking.",
    unitCost: "8.50", parLevel: "12", reorderQty: "6",
    suppliers: [
      { supplierName: "Paramount Liquor", costPerUnit: "8.50", supplierItemCode: "PL-WR200", preferred: true },
    ],
    stockFractions: [0.70, 0.55],
  },
  {
    ingredientName: "House White (Pinot Grigio)",
    ingredientCategory: "beverages",
    baseUnit: "each",
    description: "T'Gallant Juliet Pinot Grigio. 750ml bottle. Mornington Peninsula.",
    unitCost: "7.80", parLevel: "12", reorderQty: "6",
    suppliers: [
      { supplierName: "Paramount Liquor", costPerUnit: "7.80", supplierItemCode: "PL-WW100", preferred: true },
    ],
    stockFractions: [0.85, 0.65],
  },

  // ── Packaging & Supplies ──
  {
    ingredientName: "Takeaway Container (750ml)",
    ingredientCategory: "packaging",
    baseUnit: "each",
    description: "Compostable sugarcane takeaway container, 750ml. Lid included.",
    unitCost: "0.35", parLevel: "200", reorderQty: "100",
    suppliers: [
      { supplierName: "Ecopack Australia", costPerUnit: "0.35", supplierItemCode: "EP-TC750", preferred: true },
    ],
    stockFractions: [0.80, 0.70],
  },
  {
    ingredientName: "Paper Bags (large)",
    ingredientCategory: "packaging",
    baseUnit: "each",
    description: "Kraft paper bags, large (380x150x100mm). Branded with Comfort Spoon logo.",
    unitCost: "0.18", parLevel: "300", reorderQty: "150",
    suppliers: [
      { supplierName: "Ecopack Australia", costPerUnit: "0.18", supplierItemCode: "EP-PB100", preferred: true },
    ],
    stockFractions: [0.55, 0.40], // low at both
  },
  {
    ingredientName: "Compostable Napkins (pack 500)",
    ingredientCategory: "packaging",
    baseUnit: "each",
    description: "Unbleached compostable napkins, 1-ply. Pack of 500.",
    unitCost: "12.00", parLevel: "4", reorderQty: "2",
    suppliers: [
      { supplierName: "Ecopack Australia", costPerUnit: "12.00", supplierItemCode: "EP-CN500", preferred: true },
    ],
    stockFractions: [0.75, 0.50],
  },
];

// ─── Insert ingredients + relationships ─────────────────────────────

const insertedIngredients: Record<string, string> = {}; // name → ingredientId

for (const item of catalogItems) {
  const [row] = await db
    .insert(ingredient)
    .values({
      organisationId: orgId,
      ingredientName: item.ingredientName,
      ingredientCategory: item.ingredientCategory,
      baseUnit: item.baseUnit,
      description: item.description,
      unitCost: item.unitCost,
      parLevel: item.parLevel,
      reorderQty: item.reorderQty,
      containsDairyInd: item.containsDairyInd ?? false,
      containsGlutenInd: item.containsGlutenInd ?? false,
      containsNutsInd: item.containsNutsInd ?? false,
      containsShellfishInd: item.containsShellfishInd ?? false,
      containsEggsInd: item.containsEggsInd ?? false,
      isVegetarianInd: item.isVegetarianInd ?? false,
    })
    .returning();

  insertedIngredients[item.ingredientName] = row.ingredientId;
  console.log(`  Item: ${item.ingredientName} (${item.ingredientCategory})`);

  // ── Supplier links ──
  for (const sup of item.suppliers) {
    const supId = insertedSuppliers[sup.supplierName];
    if (!supId) {
      console.warn(`    WARNING: Supplier '${sup.supplierName}' not found, skipping link`);
      continue;
    }
    await db.insert(ingredientSupplier).values({
      ingredientId: row.ingredientId,
      supplierId: supId,
      costPerUnit: sup.costPerUnit,
      supplierItemCode: sup.supplierItemCode,
      preferredInd: sup.preferred,
    });
    console.log(`    → ${sup.supplierName} $${sup.costPerUnit}/${item.baseUnit} [${sup.supplierItemCode}]${sup.preferred ? " ★" : ""}`);
  }

  // ── Location-ingredient activation + stock levels ──
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const fraction = item.stockFractions[i] ?? item.stockFractions[0];
    const parNum = parseFloat(item.parLevel);
    const currentQty = Math.round(parNum * fraction * 10) / 10; // 1 decimal

    // Activate ingredient at this location
    await db.insert(locationIngredient).values({
      ingredientId: row.ingredientId,
      storeLocationId: loc.storeLocationId,
      parLevel: item.parLevel,
      reorderQty: item.reorderQty,
      unitCost: item.unitCost,
      activeInd: true,
    });

    // Set stock level
    await db.insert(stockLevel).values({
      ingredientId: row.ingredientId,
      storeLocationId: loc.storeLocationId,
      currentQty: String(currentQty),
      lastCountedDttm: new Date(),
    });
  }
}

// ─── Summary ────────────────────────────────────────────────────────

console.log("\n══════════════════════════════════════════");
console.log("  Inventory seed complete!");
console.log(`  Suppliers:    ${Object.keys(insertedSuppliers).length}`);
console.log(`  Catalog items: ${Object.keys(insertedIngredients).length}`);
console.log(`  Locations:    ${locations.length}`);
console.log("══════════════════════════════════════════\n");

process.exit(0);
