/**
 * Labelled diffs for the semantic-lint pilot. The fake secrets below are assembled at runtime on purpose:
 * GitHub push protection blocks any key-shaped literal, even a made-up one.
 *
 * BAD are synthetic diffs that each violate
 * exactly one rule in rules.mjs (written to look like this repo's code). CLEAN_PRS are real
 * merged PRs assumed clean for these rules; anything Jev flags in them gets read by a human,
 * because the assumption may be wrong.
 */
const d = (file, body) => `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -10,6 +10,${body.split("\n").length + 6} @@\n${body}\n`;

export const BAD = [
  { rule: "business_logic_in_route", diff: d("packages/server/src/routes/waste.ts", `+router.post("/summary", authenticate, async (req, res) => {
+  const rows = await db.select().from(wasteLog).where(eq(wasteLog.organisationId, req.user.orgId));
+  let total = 0;
+  for (const r of rows) {
+    const cost = Number(r.quantity) * Number(r.unitCost);
+    total += r.reason === "spoiled" ? cost * 1.1 : cost;
+  }
+  const alert = total > 500 ? "high" : "normal";
+  res.json({ total, alert });
+});`) },
  { rule: "business_logic_in_route", diff: d("packages/server/src/controllers/orderController.ts", `+export async function handleApprove(req: Request, res: Response) {
+  const po = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, req.params.id));
+  const lines = await db.select().from(purchaseOrderLine).where(eq(purchaseOrderLine.purchaseOrderId, po[0].id));
+  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
+  const gst = subtotal * 0.1;
+  if (subtotal + gst > po[0].budgetLimit) { res.status(400).json({ error: "over budget" }); return; }
+  await db.update(purchaseOrder).set({ status: "approved", total: subtotal + gst }).where(eq(purchaseOrder.id, po[0].id));
+  res.json({ ok: true });
+}`) },
  { rule: "llm_called_from_route", diff: d("packages/server/src/routes/recipes.ts", `+router.post("/suggest", authenticate, async (req, res) => {
+  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
+    method: "POST",
+    headers: { Authorization: \`Bearer \${process.env.OPENROUTER_API_KEY}\`, "Content-Type": "application/json" },
+    body: JSON.stringify({ model: process.env.AI_MODEL, messages: [{ role: "user", content: req.body.prompt }] }),
+  });
+  res.json(await r.json());
+});`) },
  { rule: "llm_called_from_route", diff: d("packages/server/src/controllers/menuController.ts", `+import Anthropic from "@anthropic-ai/sdk";
+const client = new Anthropic();
+export async function handleDescribe(req: Request, res: Response) {
+  const msg = await client.messages.create({ model: "claude-sonnet-5-5", max_tokens: 500, messages: [{ role: "user", content: \`Describe: \${req.body.dish}\` }] });
+  res.json({ text: msg.content });
+}`) },
  { rule: "hardcoded_secret_or_config", diff: d("packages/server/src/services/emailService.ts", `+const resend = new Resend("${"re" + "_"}8fK2LmNpQxT4vYzA1bC9dE3fGhJkLm");
+export async function sendReceipt(to: string, body: string) {
+  await resend.emails.send({ from: "billing@culinaire.kitchen", to, subject: "Receipt", html: body });
+}`) },
  { rule: "hardcoded_secret_or_config", diff: d("packages/server/src/services/stripeService.ts", `+const stripe = new Stripe("${"sk_" + "live_"}51Hx9aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcdef");
+const CLIENT_URL = "https://www.culinaire.kitchen";
+const DEFAULT_MODEL = "anthropic/claude-sonnet-5-5";`) },
  { rule: "endpoint_without_permission", diff: d("packages/server/src/routes/suppliers.ts", `+router.get("/export-all", async (req, res) => {
+  const rows = await db.select().from(supplier);
+  res.json(rows);
+});
+router.delete("/:id", async (req, res) => {
+  await db.delete(supplier).where(eq(supplier.supplierId, req.params.id));
+  res.json({ ok: true });
+});`) },
  { rule: "endpoint_without_permission", diff: d("packages/server/src/routes/inventory.ts", `+router.post("/adjust-stock", async (req, res, next) => {
+  try {
+    await stockService.adjust(req.body.ingredientId, req.body.delta);
+    res.json({ success: true });
+  } catch (e) { next(e); }
+});`) },
  { rule: "fk_without_index", diff: d("packages/server/src/db/schema.ts", `+export const kitchenTask = pgTable("kitchen_task", {
+  taskId: uuid("task_id").defaultRandom().primaryKey(),
+  organisationId: integer("organisation_id").notNull().references(() => organisation.organisationId),
+  assignedUserId: integer("assigned_user_id").references(() => user.userId),
+  title: varchar("title", { length: 200 }).notNull(),
+  createdAt: timestamp("created_at").notNull().defaultNow(),
+});`) },
  { rule: "fk_without_index", diff: d("packages/server/src/db/schema.ts", `+export const wasteReason = pgTable("waste_reason", {
+  wasteReasonId: uuid("waste_reason_id").defaultRandom().primaryKey(),
+  storeLocationId: uuid("store_location_id").notNull().references(() => storeLocation.storeLocationId),
+  label: varchar("label", { length: 80 }).notNull(),
+}, (table) => [
+  uniqueIndex("idx_waste_reason_label").on(table.label),
+]);`) },
];

/** Merged PRs whose code diff is assumed clean for every rule. */
export const CLEAN_PRS = [86, 94, 95, 96, 97, 98, 99, 100, 101, 136, 137, 138, 139, 140, 141, 144, 146, 149, 150, 152, 154, 156];
