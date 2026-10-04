/**
 * E2E coverage for guide-first ordering (Purchasing P1).
 *
 * Covers the flow the whole feature exists for: pick a guide -> the draft
 * arrives filled to par -> the operator reviews and adjusts -> send.
 *
 * Prereqs (run manually in separate terminals):
 *   pnpm --filter @culinaire/server dev     # port 3009
 *   pnpm --filter @culinaire/client dev     # port 5179
 *
 * Needs a Cloudflare Turnstile TEST secret (Settings -> Integrations) so the
 * one-time login in auth.setup.ts can pass; verification is fail-closed with no
 * dev bypass. See docs/specs/purchasing-order-guides.md.
 *
 * Self-seeding: beforeAll creates a prefixed supplier, 3 costed ingredients with
 * pars and nothing on hand, and a guide over them; the worker's cleanup removes
 * them. Tests pick their guide by its prefixed name, so other guides cannot
 * affect them and a par-less dataset cannot make them pass vacuously.
 *
 * Run:   pnpm --filter @culinaire/client test:e2e order-guides
 */

import type { Page } from "@playwright/test";
import { test, expect } from "./_helpers/test";
import { seedOrderGuide } from "./_helpers/purchasingData";

let seed: Awaited<ReturnType<typeof seedOrderGuide>>;

test.beforeAll(async ({ api, defer }) => {
  test.setTimeout(120_000);
  seed = await seedOrderGuide(api, defer);
});

async function openNewPoForm(page: Page) {
  await page.goto("/purchasing");
  // No waitForLoadState — networkidle never resolves (socket.io); domcontentloaded fires before React renders.
  // Button was renamed from "New Purchase Order" to "New PO".
  await page.locator('button:has-text("New PO")').first().click({ timeout: 30_000 });
}

/** Clicks the seeded guide's pill and waits for the par context to arrive. */
async function applySeededGuide(page: Page) {
  await page.getByRole("button", { name: seed.guide.name }).click({ timeout: 30_000 });
  await expect(page.getByText(/^Par: /).first()).toBeVisible({ timeout: 10_000 });
}

test.describe("Guide-first ordering", () => {
  test.beforeEach(async ({ page }) => {
    await openNewPoForm(page);
  });

  test("picking a guide prefills the draft to par", async ({ page }) => {
    await applySeededGuide(page);

    // The point of the feature: the operator reads par context per line
    // instead of computing quantities in their head.
    await expect(page.getByText(/^In stock: /).first()).toBeVisible();
    await expect(page.getByText(/^Par: /).first()).toBeVisible();

    // At least one line must arrive with a quantity already filled — a guide
    // that prefills nothing is the pre-rework catalogue experience.
    const qtyInputs = page.locator('input[type="number"]');
    const values = await qtyInputs.evaluateAll((els) =>
      els.map((e) => Number((e as HTMLInputElement).value) || 0),
    );
    expect(values.some((v) => v > 0), "guide should prefill at least one qty").toBe(true);
  });

  test("TO PAR restores a line the operator overwrote", async ({ page }) => {
    await applySeededGuide(page);

    const toPar = page.locator('button:has-text("TO PAR")').first();
    await expect(toPar).toBeVisible();

    // Find the qty input belonging to the same line as the first TO PAR chip.
    const line = toPar.locator("xpath=ancestor::*[.//input[@type='number']][1]");
    const qty = line.locator('input[type="number"]').first();
    const suggested = await qty.inputValue();

    await qty.fill("1");
    await expect(qty).toHaveValue("1");
    await toPar.click();
    await expect(qty).toHaveValue(suggested);
  });

  test("order everything to par re-snaps every guide line at once", async ({ page }) => {
    await applySeededGuide(page);

    const before = await page
      .locator('input[type="number"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

    // Zero the first line, then re-snap the whole draft.
    await page.locator('input[type="number"]').first().fill("0");
    await page.locator('button:has-text("Order everything to par")').first().click();

    await expect(async () => {
      const after = await page
        .locator('input[type="number"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      expect(after).toEqual(before);
    }).toPass({ timeout: 5_000 });
  });

  test("review and send: the draft reaches a submittable state", async ({ page }) => {
    await applySeededGuide(page);

    // A prefilled guide draft must be sendable without further data entry —
    // that is the whole reduction in operator work this feature claims.
    const submit = page.locator(
      'button:has-text("Create Purchase Order"), button:has-text("Save"), button[type="submit"]',
    ).last();
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
  });
});
