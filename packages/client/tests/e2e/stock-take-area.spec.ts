/**
 * E2E coverage for opening a stock take by storage area (mobile release 1, X1).
 *
 * The web only OPENS an area count; chefs count it on the phone. So the browser part
 * is: pick areas, see the server's closed-set refusal when two areas that share an item
 * are split, then open with both and see a status-only area count. The phone's side
 * (claim, count, submit, review, approve) is driven through the API in the same spec,
 * which also leaves the location with no open session so the spec can be rerun.
 *
 * Prereqs: API on 3009, web on 5179, a Turnstile test secret (see order-guides.spec.ts).
 * Self-seeding: creates a prefixed ingredient shared by two prefixed areas. The E2E location
 * is already past opening inventory (seedE2eCiData sets it).
 * Not undone: approving the area count writes stock lines that reference the ingredient, so it
 * stays. That is fine for the throwaway CI database and the local one; do not run this spec
 * against a shared database.
 *
 * Run:   pnpm --filter @culinaire/client test:e2e stock-take-area
 */

import { test, expect } from "./_helpers/test";
import { apiCall } from "./_helpers/data";
import { currentPrefix } from "./_helpers/safety";

const API = "/api/inventory";

interface Session { sessionId: string; sessionStatus: string; categories: Array<{ categoryName: string }> }

let locationId = "";
let ingredientId = "";
let barName = "";
let pantryName = "";

/** Submitting the last category moves the session to PENDING_REVIEW by itself; approve it (an OPEN one needs a submit first). */
async function approveWhenSubmitted(api: Parameters<typeof apiCall>[0], sessionId: string) {
  let s = await apiCall<Session>(api, "GET", `${API}/stock-takes/${sessionId}`);
  if (s.sessionStatus === "OPEN") {
    await apiCall(api, "POST", `${API}/stock-takes/${sessionId}/submit-for-review`);
    s = await apiCall<Session>(api, "GET", `${API}/stock-takes/${sessionId}`);
  }
  if (s.sessionStatus === "PENDING_REVIEW") await apiCall(api, "POST", `${API}/stock-takes/${sessionId}/approve`);
}

test.beforeAll(async ({ api, defer }) => {
  test.setTimeout(120_000);
  const prefix = currentPrefix();
  const ctx = await apiCall<{ selectedLocationId: string | null }>(api, "GET", "/api/users/location-context");
  if (!ctx.selectedLocationId) throw new Error("E2E user has no selected location; seeding needs one");
  locationId = ctx.selectedLocationId;

  const ing = await apiCall<{ ingredientId: string }>(api, "POST", `${API}/ingredients`, {
    ingredientName: `${prefix}area-shared-item`,
    ingredientCategory: "produce",
    baseUnit: "kg",
    unitCost: "2.50",
  });
  ingredientId = ing.ingredientId;

  barName = `${prefix}Bar`;
  pantryName = `${prefix}Pantry`;
  for (const [i, name] of [barName, pantryName].entries()) {
    const area = await apiCall<{ storageAreaId: string }>(api, "POST", `${API}/locations/${locationId}/storage-areas`, {
      areaName: name, sortOrder: 900 + i,
    });
    defer(`storage area ${name}`, async () => {
      await apiCall(api, "DELETE", `${API}/storage-areas/${area.storageAreaId}`);
    });
    // The same item sits in both areas, so the two must be counted together.
    await apiCall(api, "PUT", `${API}/storage-areas/${area.storageAreaId}/items`, { items: [{ ingredientId }] });
  }
});

test("opening by area: a split pair is refused with the server's message, both areas open a status-only count", async ({ page, api }) => {
  await page.goto("/inventory?tab=stock-take");
  await page.getByRole("button", { name: "Count by Area" }).click({ timeout: 30_000 });

  // Leave Pantry out: Bar and Pantry share an item, so the server must refuse.
  await page.getByLabel(pantryName).uncheck();
  await page.getByRole("button", { name: /^Start \(/ }).click();
  await expect(page.getByText(/Add .*Pantry.* to this count/)).toBeVisible({ timeout: 15_000 });

  // Every area ticked: opens.
  await page.getByLabel(pantryName).check();
  await page.getByRole("button", { name: /^Start \(/ }).click();
  await expect(page.getByText(/counts by storage area/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(barName)).toBeVisible();
  await expect(page.getByText(pantryName)).toBeVisible();
  await expect(page.getByRole("button", { name: /Start Counting/ })).toHaveCount(0);

  // The phone side, over the API: claim and count both areas, submit, review, approve. Leaves no open session.
  const session = await apiCall<Session>(api, "GET", `${API}/stock-takes/active`);
  expect(session.categories.map((c) => c.categoryName)).toEqual(expect.arrayContaining([barName, pantryName]));
  for (const name of [barName, pantryName]) {
    await apiCall(api, "POST", `${API}/stock-takes/${session.sessionId}/categories/${encodeURIComponent(name)}/claim`);
    await apiCall(api, "POST", `${API}/stock-takes/${session.sessionId}/categories/${encodeURIComponent(name)}/lines`, {
      ingredientId, rawQty: 2, countedUnit: "kg",
    });
    await apiCall(api, "POST", `${API}/stock-takes/${session.sessionId}/categories/${encodeURIComponent(name)}/submit`);
  }
  await approveWhenSubmitted(api, session.sessionId);
});
