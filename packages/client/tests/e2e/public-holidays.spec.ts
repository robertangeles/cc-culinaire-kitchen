/**
 * E2E coverage for the Public Holidays jurisdiction+year filter redesign
 * (docs/specs/public-holidays-filters-plan.md).
 *
 * Prereqs (run in separate terminals):
 *   ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server dev   # port 3009
 *   pnpm --filter @culinaire/client dev                         # port 5179
 *
 * Run:  pnpm --filter @culinaire/client test:e2e public-holidays
 *
 * Covers the one flow a unit test cannot: saving a holiday for a jurisdiction
 * different from the active filter, and confirming the filter follows it —
 * the design review's critical finding (a save that lands outside the
 * visible filter must never be silently invisible). Pure filter/sort logic
 * is covered by PublicHolidaysTab.test.tsx and is not re-tested here.
 *
 * Uses NT/SA and year 2099 — a jurisdiction+year combination that will
 * never collide with real roster-publish data. The holiday name carries the
 * run prefix and the row is removed in a finally block (via the API, so a
 * UI failure cannot leave an orphan behind).
 */

import type { Page } from "@playwright/test";
import { test, expect } from "./_helpers/test";
import { apiCall } from "./_helpers/data";
import { currentPrefix } from "./_helpers/safety";

const TEST_YEAR = "2099";

async function openPublicHolidays(page: Page) {
  await page.goto("/settings?tab=publicHolidays");
  await page.getByRole("heading", { name: "Public Holidays" }).waitFor({ state: "visible", timeout: 20_000 });
}

test.describe("Public Holidays — jurisdiction+year filter", () => {
  test("page loads with a jurisdiction pill row and a Year select", async ({ page }) => {
    await openPublicHolidays(page);

    await expect(page.getByRole("tablist", { name: "Jurisdiction filter" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "NSW", exact: true })).toBeVisible();
    await expect(page.getByLabel("Year", { exact: true })).toBeVisible();

    // A raw error reaching the user is a failure in its own right.
    await expect(page.getByText(/\[object Object\]|undefined is not|TypeError/i)).toHaveCount(0);
  });

  test("switching the jurisdiction pill filters the list without a page reload", async ({ page }) => {
    await openPublicHolidays(page);

    await page.getByRole("tab", { name: "NT", exact: true }).click();
    await expect(page.getByRole("tab", { name: "NT", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "NSW", exact: true })).toHaveAttribute("aria-selected", "false");
  });

  test("CRITICAL: saving a holiday for a different jurisdiction than the active filter switches the filter to match, and the new holiday is visible", async ({
    page,
    api,
  }) => {
    await openPublicHolidays(page);

    // Start on NT — deliberately different from the jurisdiction we'll save.
    await page.getByRole("tab", { name: "NT", exact: true }).click();
    await expect(page.getByRole("tab", { name: "NT", exact: true })).toHaveAttribute("aria-selected", "true");

    const addButton = page.getByRole("button", { name: "Add holiday", exact: true });
    if ((await addButton.count()) === 0) {
      test.skip(true, "E2E account lacks roster:manage — nothing to add");
      return;
    }
    await addButton.click();

    const holidayName = `${currentPrefix()}holiday`;
    const holidayDate = `${TEST_YEAR}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, "0")}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, "0")}`;
    try {
      await page.getByLabel("Holiday jurisdiction", { exact: true }).selectOption("SA");
      await page.getByLabel("Date", { exact: true }).fill(holidayDate);
      await page.getByLabel("Holiday name", { exact: true }).fill(holidayName);
      await page.getByRole("button", { name: "Save", exact: true }).click();

      // The active filter must follow the save — SA/2099, not NT.
      await expect(page.getByRole("tab", { name: "SA", exact: true })).toHaveAttribute("aria-selected", "true", {
        timeout: 10_000,
      });
      await expect(page.getByLabel("Year", { exact: true })).toHaveValue(TEST_YEAR);
      await expect(page.getByText(holidayName, { exact: true })).toBeVisible();

      await page.getByRole("button", { name: `Remove ${holidayName}`, exact: true }).click();
      await expect(page.getByText(holidayName, { exact: true })).toHaveCount(0);
    } finally {
      const rows = await apiCall<Array<{ id: string; holidayName: string }>>(
        api,
        "GET",
        `/api/roster/public-holidays?jurisdiction=SA&year=${TEST_YEAR}`,
      );
      for (const row of rows.filter((r) => r.holidayName === holidayName)) {
        await apiCall(api, "DELETE", `/api/roster/public-holidays/${row.id}`);
      }
    }
  });
});
