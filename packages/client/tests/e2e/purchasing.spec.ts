/**
 * E2E coverage for Purchasing & Receiving v1.
 *
 * Prereqs (run manually in separate terminals):
 *   pnpm --filter @culinaire/server dev     # port 3009
 *   pnpm --filter @culinaire/client dev     # port 5179
 *
 * Self-seeding: beforeAll creates a prefixed supplier and one purchase order per
 * status the tests need, and the worker's cleanup cancels them. Tests locate
 * their order by its id, so other people's orders cannot affect them.
 *
 * Run:   pnpm --filter @culinaire/client test:e2e purchasing
 */

import type { Page } from "@playwright/test";
import { test, expect } from "./_helpers/test";
import { seedPurchaseOrders } from "./_helpers/purchasingData";

let seed: Awaited<ReturnType<typeof seedPurchaseOrders>>;

test.beforeAll(async ({ api, defer }) => {
  test.setTimeout(180_000);
  seed = await seedPurchaseOrders(api, defer);
});

/** The list card for one seeded order. */
const poRow = (page: Page, poId: string) => page.locator(`[data-po-id="${poId}"]`);

async function openOrdersTab(page: Page) {
  // Purchasing is its own route since the sidebar restructure (commit 9d77f81).
  // "Orders" is the default tab on /purchasing, so a single goto is enough.
  await page.goto("/purchasing");
  // Scope to main: the guide panel also has "Purchase Orders" headings (strict-mode violation).
  // No waitForLoadState — networkidle never resolves (socket.io); domcontentloaded fires before React renders.
  await expect(page.getByRole("main").getByRole("heading", { name: "Purchase Orders", exact: true })).toBeVisible({ timeout: 30_000 });
}

/** Expands a seeded order's card and returns it. The row header is the card's first button. */
async function expandRow(page: Page, poId: string) {
  const row = poRow(page, poId);
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole("button").first().click();
  return row;
}

test.describe("Purchasing & Receiving v1", () => {
  test.beforeEach(async ({ page }) => {
    await openOrdersTab(page);
  });

  test("renders PO list with status badges", async ({ page }) => {
    const { draft, pending, sent } = seed.pos;
    await expect(poRow(page, draft.id).getByText("Draft", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(poRow(page, pending.id).getByText("Pending Approval", { exact: true })).toBeVisible();
    await expect(poRow(page, sent.id).getByText("Sent", { exact: true })).toBeVisible();
  });

  test("first PO row expands to show detail", async ({ page }) => {
    const row = await expandRow(page, seed.pos.draft.id);
    // After expansion, every PO shows at least one action button regardless of status:
    // active statuses → Approve/Reject/Submit/Receive Delivery + PDF; terminal → Reorder.
    const anyAction = row.getByRole("button", { name: /Approve|Reject|Submit|Receive Delivery|PDF|Reorder/ });
    await expect(anyAction.first()).toBeVisible({ timeout: 10_000 });
  });

  test("Pending Approval PO exposes Approve and Reject buttons", async ({ page }) => {
    const row = await expandRow(page, seed.pos.pending.id);
    await expect(row.getByRole("button", { name: "Approve" })).toBeVisible({ timeout: 10_000 });
    await expect(row.getByRole("button", { name: "Reject" })).toBeVisible();
  });

  test("Sent PO exposes Receive Delivery button", async ({ page }) => {
    const row = await expandRow(page, seed.pos.sent.id);
    await expect(row.getByRole("button", { name: "Receive Delivery" })).toBeVisible({ timeout: 10_000 });
  });

  test("Draft PO exposes Submit button", async ({ page }) => {
    const row = await expandRow(page, seed.pos.draft.id);
    await expect(row.getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 10_000 });
  });

  test("Receive Delivery flow opens receiving screen with Confirm action", async ({ page }) => {
    const row = await expandRow(page, seed.pos.sentToReceive.id);
    await row.getByRole("button", { name: "Receive Delivery" }).click({ timeout: 10_000 });

    await expect(page.getByRole("button", { name: /Confirm Receipt/ }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Receiving:/i).first()).toBeVisible();
  });

  test('"Sent" status filter narrows the list', async ({ page }) => {
    const { draft, pending, sent } = seed.pos;
    // Exact name: the order cards' buttons have long names and cannot match.
    await page.getByRole("button", { name: "Sent", exact: true }).click();
    await expect(poRow(page, sent.id)).toBeVisible({ timeout: 15_000 });
    await expect(poRow(page, draft.id)).toHaveCount(0);
    await expect(poRow(page, pending.id)).toHaveCount(0);
  });
});
