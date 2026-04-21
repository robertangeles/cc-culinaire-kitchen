/**
 * Intentional snapshot helper for the Purchase Orders list.
 * Emits 3 reference PNGs (desktop list, expanded detail, mobile) into
 * tests/e2e/__snapshots__/. Snapshot output is gitignored by default.
 *
 * Run:   pnpm --filter @culinaire/client test:e2e -- purchase-orders.screenshots
 */

import { test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loginAsTestUser } from "./_helpers/login";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, "__snapshots__");

async function gotoPoTab(page: import("@playwright/test").Page) {
  // Orders is the default tab on /purchasing.
  await page.goto("/purchasing");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

test.describe.configure({ mode: "serial" });

test.describe("Purchase Orders — reference snapshots", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTestUser(page);
    await gotoPoTab(page);
  });

  test("desktop: full list with all status badges", async ({ page }) => {
    await page.screenshot({
      path: path.join(SNAPSHOT_DIR, "po-list-all-statuses.png"),
      fullPage: false,
    });
  });

  test("desktop: expanded PO detail", async ({ page }) => {
    const firstRow = page
      .locator('[class*="rounded-xl"][class*="backdrop"]')
      .first();
    await firstRow.click();
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: path.join(SNAPSHOT_DIR, "po-expanded-detail.png"),
      fullPage: false,
    });
  });

  test("mobile 390×844: list", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(SNAPSHOT_DIR, "po-list-mobile.png"),
      fullPage: false,
    });
  });
});
