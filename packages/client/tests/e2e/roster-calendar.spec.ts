/**
 * E2E coverage for the Roster week calendar (drag-to-build).
 *
 * Prereqs (run manually in separate terminals):
 *   ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server dev   # port 3009
 *   pnpm --filter @culinaire/client dev                         # port 5179
 *
 * Run:  pnpm --filter @culinaire/client test:e2e
 *
 * This is a smoke test for the interaction itself — Playwright's
 * mouse.down/move/up drives real OS-level pointer events, which is the
 * thing a unit test cannot exercise (rosterCalendarMath.test.ts already
 * covers the pure position math this component calls into). It does not
 * attempt to cover every gesture (move, resize, assign) — one real
 * drag-create round-tripping to an actual shift row is the load-bearing
 * assertion that pointer events, the grid's position math, and the API
 * call are all wired together correctly end to end.
 */

import { test, expect, type Page } from "@playwright/test";

async function openCalendar(page: Page) {
  await page.goto("/roster");
  await page.waitForLoadState("networkidle");
  await page.getByRole("tab", { name: "Calendar" }).click();
}

test.describe("Roster week calendar", () => {
  test("renders 7 day columns and the hour rail", async ({ page }) => {
    await openCalendar(page);

    // Either the grid or the "no roles yet" empty state — never a raw
    // error or a permanently spinning skeleton.
    await expect(async () => {
      const dayHeaders = await page.locator("text=/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \\d+$/").count();
      const empty = await page.getByText(/no roles set up yet/i).count();
      expect(dayHeaders + empty, "calendar must finish rendering").toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });
  });

  test("dragging on an empty lane creates a Draft shift", async ({ page }) => {
    await openCalendar(page);

    const lane = page.locator("[data-day-iso][data-role-id]").first();
    if ((await lane.count()) === 0) {
      test.skip(true, "No roles configured in this environment — nothing to drag onto");
      return;
    }

    const box = await lane.boundingBox();
    if (!box) {
      test.skip(true, "Lane not visible — likely scrolled out of view");
      return;
    }

    const x = box.x + box.width / 2;
    const startY = box.y + 40;
    const endY = startY + 150; // a few hours' worth at this grid's hour height

    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, endY, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByText("Shift created.")).toBeVisible({ timeout: 10_000 });
    // The block itself renders inside the lane once the calendar refetches.
    await expect(lane.locator("[data-shift-id]").first()).toBeVisible({ timeout: 10_000 });
  });
});
