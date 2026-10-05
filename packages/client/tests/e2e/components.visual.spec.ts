/**
 * Screenshot comparison for the components split in the 2026 refactor. A
 * refactor that keeps every behaviour but breaks the layout (a lost class, a
 * wrapper that collapses a flex row) passes the functional specs; this fails it.
 *
 * Baselines live in tests/e2e/visual-baselines/ and are drawn by CI (Linux), so
 * this project only runs in CI or with E2E_VISUAL=1. It runs first, on the
 * seeded database, so the pages show only seed data. To refresh a baseline,
 * run the CI job's artifact through the update steps in docs/e2e.md.
 */
import type { Page } from "@playwright/test";
import { test, expect } from "./_helpers/test";

/** Fonts loaded and no spinner left, so a shot never captures a loading state. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".animate-spin")).toHaveCount(0, { timeout: 15_000 });
}

const shot = { animations: "disabled", caret: "hide" } as const;

test.describe("Refactored components: visual", () => {
  test("ProfilePage: Profile tab", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible({ timeout: 20_000 });
    await settled(page);
    await expect(page).toHaveScreenshot("profile-page.png", shot);
  });

  test("StoreLocationsSection: Locations sub-tab", async ({ page }) => {
    await page.goto("/profile");
    await page.getByRole("tab", { name: "Profile", exact: true }).click({ timeout: 20_000 });
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Store Locations \(\d+\)$/ })).toBeVisible({ timeout: 15_000 });
    await settled(page);
    await expect(page).toHaveScreenshot("store-locations.png", shot);
  });

  test("UserDetailPanel: detail dialog", async ({ page }) => {
    await page.goto("/settings?tab=users");
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    await firstRow.locator("td").first().click();
    const dialog = page.getByRole("dialog", { name: /^User details:/ });
    await expect(dialog).toBeVisible();
    await settled(page);
    // The joined date changes every run.
    await expect(dialog).toHaveScreenshot("user-detail-panel.png", {
      ...shot,
      mask: [dialog.getByText(/^[A-Z][a-z]{2} \d{1,2}, \d{4}/)],
    });
  });

  test("MenuItemFormModal: create-from-scratch form", async ({ page }) => {
    await page.goto("/menu-intelligence");
    await page.getByRole("button", { name: "Menu Items", exact: true }).click({ timeout: 20_000 });
    await page.getByRole("button", { name: "Add Menu Item" }).first().click({ timeout: 20_000 });
    await page.getByRole("button", { name: "Create from Scratch" }).click();
    await expect(page.getByPlaceholder("e.g. Pan-Seared Salmon")).toBeVisible();
    await settled(page);
    await expect(page).toHaveScreenshot("menu-item-form-modal.png", shot);
  });

  test("IngredientCatalog: Catalog tab", async ({ page }) => {
    await page.goto("/inventory");
    await page.getByRole("tab", { name: "Catalog", exact: true }).click({ timeout: 20_000 });
    await expect(page.getByPlaceholder("Search items...")).toBeVisible({ timeout: 15_000 });
    await settled(page);
    await expect(page).toHaveScreenshot("ingredient-catalog.png", shot);
  });
});
