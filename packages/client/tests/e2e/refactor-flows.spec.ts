/**
 * Functional flows through the units split in the 2026 refactor:
 * MenuItemFormModal, IngredientCatalog, ProfilePage, UserDetailPanel,
 * StoreLocationsSection (components) and useInventory, useRoster (hooks,
 * exercised through the Inventory and Roster pages). Read-only: each flow opens
 * and closes UI without saving, so nothing is written to the shared dev DB.
 */
import { test, expect } from "./_helpers/test";

test.describe("Refactored components", () => {
  test("ProfilePage: tabs switch and the Profile tab shows Store Locations", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible({ timeout: 20_000 });

    for (const name of ["Security", "Account Details", "Profile"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    }

    // StoreLocationsSection renders inside OrgTab, on its "Locations" sub-tab of the "Profile" tab.
    await page.getByRole("button", { name: "Locations", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Store Locations \(\d+\)$/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Add Location" })).toBeVisible();
  });

  test("UserDetailPanel: clicking a user row opens the detail dialog and Escape closes it", async ({ page }) => {
    await page.goto("/settings?tab=users");
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 20_000 });
    // The centre of a row is the role dropdown; the name cell is plain row area.
    await firstRow.locator("td").first().click();

    const dialog = page.getByRole("dialog", { name: /^User details:/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Account" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("MenuItemFormModal: Add Menu Item opens the form and Cancel closes it", async ({ page }) => {
    await page.goto("/menu-intelligence");
    await page.getByRole("button", { name: "Menu Items", exact: true }).click({ timeout: 20_000 });
    await page.getByRole("button", { name: "Add Menu Item" }).first().click({ timeout: 20_000 });

    await expect(page.getByRole("heading", { name: "Add Menu Item" })).toBeVisible();
    await page.getByRole("button", { name: "Create from Scratch" }).click();
    await expect(page.getByPlaceholder("e.g. Pan-Seared Salmon")).toBeVisible();

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Add Menu Item" })).toHaveCount(0);
  });

  test("IngredientCatalog + useInventory: Inventory Catalog tab loads with a search box", async ({ page }) => {
    await page.goto("/inventory");
    await page.getByRole("tab", { name: "Catalog", exact: true }).click({ timeout: 20_000 });
    await expect(page.getByPlaceholder("Search items...")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Refactored hooks", () => {
  test("useInventory: the Inventory dashboard loads without error", async ({ page }) => {
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "Inventory", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\[object Object\]|undefined is not|TypeError/i)).toHaveCount(0);
  });

  test("useRoster: the Roster page loads its tabs", async ({ page }) => {
    await page.goto("/roster");
    await expect(page.getByRole("tab", { name: "Calendar" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/\[object Object\]|undefined is not|TypeError/i)).toHaveCount(0);
  });
});
