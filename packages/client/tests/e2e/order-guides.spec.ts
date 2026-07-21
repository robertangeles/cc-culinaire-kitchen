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
 * Also needs, or every test below self-skips:
 *   - a Cloudflare Turnstile TEST secret configured (Settings -> Integrations).
 *     Verification is fail-closed with no dev bypass, so form login is
 *     otherwise impossible from a browser. See docs/specs/purchasing-order-guides.md.
 *   - at least one order guide on the selected location, with pars set on its
 *     items (Inventory -> Setup -> Par Levels). Order-to-par renders nothing
 *     without pars, so a par-less dataset would make these pass vacuously.
 *
 * Run:   pnpm --filter @culinaire/client test:e2e order-guides
 */

import { test, expect, type Page } from "@playwright/test";
import { loginAsTestUser } from "./_helpers/login";

async function openNewPoForm(page: Page) {
  await page.goto("/purchasing");
  await page.waitForLoadState("networkidle");
  await page.locator('button:has-text("New Purchase Order")').first().click();
  await expect(page.getByText("New Purchase Order").first()).toBeVisible();
}

/** Clicks the first guide pill. Returns false when the dataset has no guides. */
async function applyFirstGuide(page: Page) {
  const orderToPar = page.locator('button:has-text("Order everything to par")');
  // The whole guide panel only renders when guides.length > 0.
  if ((await orderToPar.count()) === 0) return false;

  // Guide pills sit beside the "Order everything to par" action in the panel.
  const pill = page.locator('button:has-text("items")').first();
  if ((await pill.count()) === 0) return false;
  await pill.click();
  await expect(page.getByText(/On hand /).first()).toBeVisible({ timeout: 10_000 });
  return true;
}

test.describe("Guide-first ordering", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await openNewPoForm(page);
  });

  test("picking a guide prefills the draft to par", async ({ page }) => {
    const found = await applyFirstGuide(page);
    test.skip(!found, "No order guide in current dataset");

    // The point of the feature: the operator reads par context per line
    // instead of computing quantities in their head.
    await expect(page.getByText(/On hand .* \/ par /).first()).toBeVisible();

    // At least one line must arrive with a quantity already filled — a guide
    // that prefills nothing is the pre-rework catalogue experience.
    const qtyInputs = page.locator('input[type="number"]');
    const values = await qtyInputs.evaluateAll((els) =>
      els.map((e) => Number((e as HTMLInputElement).value) || 0),
    );
    expect(values.some((v) => v > 0), "guide should prefill at least one qty").toBe(true);
  });

  test("TO PAR restores a line the operator overwrote", async ({ page }) => {
    const found = await applyFirstGuide(page);
    test.skip(!found, "No order guide in current dataset");

    const toPar = page.locator('button:has-text("TO PAR")').first();
    test.skip((await toPar.count()) === 0, "No below-par line in current dataset");

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
    const found = await applyFirstGuide(page);
    test.skip(!found, "No order guide in current dataset");

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
    const found = await applyFirstGuide(page);
    test.skip(!found, "No order guide in current dataset");

    // A prefilled guide draft must be sendable without further data entry —
    // that is the whole reduction in operator work this feature claims.
    const submit = page.locator(
      'button:has-text("Create Purchase Order"), button:has-text("Save"), button[type="submit"]',
    ).last();
    await expect(submit).toBeVisible();
    await expect(submit).toBeEnabled();
  });
});
