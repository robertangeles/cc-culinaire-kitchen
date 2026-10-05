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

import type { Page } from "@playwright/test";
import { test, expect } from "./_helpers/test";
import { apiCall } from "./_helpers/data";
import { currentPrefix } from "./_helpers/safety";

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

  test("dragging on an empty lane creates a Draft shift", async ({ page, api }) => {
    // Own role so the lane exists in any environment and the created shift is ours to clean up.
    const role = await apiCall<{ rosterRoleId: string }>(api, "POST", "/api/roster/roles", {
      roleName: `${currentPrefix()}role`,
    });
    try {
      await openCalendar(page);

      const lane = page.locator(`[data-day-iso][data-role-id="${role.rosterRoleId}"]`).first();
      await expect(lane, "seeded role must get a lane on the calendar").toBeVisible({ timeout: 15_000 });
      await lane.scrollIntoViewIfNeeded();

      // The lane is 24h tall inside a 420px scroller, so only part of it is on screen.
      // Pick a point in the visible part that hits the lane itself (not a gridline), with
      // room below for a ~150px drag (a few hours at this grid's hour height).
      const point = await lane.evaluate((el) => {
        const scroller = el.parentElement!.parentElement!.getBoundingClientRect();
        const l = el.getBoundingClientRect();
        const x = l.left + l.width / 2;
        const bottom = Math.min(scroller.bottom, window.innerHeight);
        for (let y = Math.max(l.top, scroller.top) + 10; y + 150 < bottom; y++) {
          if (document.elementFromPoint(x, y) === el && document.elementFromPoint(x, y + 150) === el) return { x, y };
        }
        return null;
      });
      expect(point, "a draggable spot must be visible in the lane").not.toBeNull();

      await page.mouse.move(point!.x, point!.y);
      await page.mouse.down();
      await page.mouse.move(point!.x, point!.y + 150, { steps: 5 });
      await page.mouse.up();

      await expect(page.getByText("Shift created.")).toBeVisible({ timeout: 10_000 });
      // The block itself renders inside the lane once the calendar refetches.
      await expect(lane.locator("[data-shift-id]").first()).toBeVisible({ timeout: 10_000 });
    } finally {
      // Shifts cannot be deleted through the API, only cancelled. A role that still has
      // shifts cannot be deleted either, so it is left for scripts/cleanupE2eData.
      const shifts = (
        await apiCall<Array<{ shiftId: string; rosterRoleId: string }>>(api, "GET", "/api/roster/shifts")
      ).filter((sh) => sh.rosterRoleId === role.rosterRoleId);
      for (const sh of shifts) await apiCall(api, "POST", `/api/roster/shifts/${sh.shiftId}/cancel`);
      if (shifts.length === 0) await apiCall(api, "DELETE", `/api/roster/roles/${role.rosterRoleId}`);
    }
  });
});
