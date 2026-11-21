/**
 * E2E coverage for the phone app's "update to continue" rule (mobile release 1).
 *
 * An Administrator sets the minimum phone app version in Settings, Site Settings. A phone older than it is
 * refused with 426 at sign-in and at the count download, a phone at or above it, and the web (no version
 * header), are not, and saving a count is never blocked. Restores the original value afterwards.
 *
 * Prereqs: API on 3009, web on 5179 (see order-guides.spec.ts).
 * Run:   pnpm --filter @culinaire/client test:e2e phone-min-version
 */

import { request } from "@playwright/test";
import { test, expect } from "./_helpers/test";
import { apiCall } from "./_helpers/data";
import { e2eBaseUrl } from "./_helpers/safety";

const version = (v: string) => ({ "X-Mobile-App-Version": v });

test("an admin sets the minimum phone app version: old phones are asked to update, current phones and the web are not", async ({ page, api, defer }) => {
  const before = (await apiCall<{ settings: Record<string, string> }>(api, "GET", "/api/settings")).settings.mobile_min_app_version ?? "0.0.0";
  defer("restore the minimum phone app version", async () => {
    await apiCall(api, "PUT", "/api/settings", { mobile_min_app_version: before });
  });

  await page.goto("/settings?tab=siteSettings");
  const field = page.getByLabel("Minimum phone app version");
  await field.waitFor({ timeout: 30_000 });

  // A value that is not a version is refused with a plain sentence and nothing is saved.
  await field.fill("banana");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/must look like 1\.2\.3/)).toBeVisible({ timeout: 15_000 });

  await field.fill("9.9.9");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved successfully")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Minimum phone app version")).toHaveValue("9.9.9", { timeout: 30_000 });

  // A phone with no session: the version check runs before the password check.
  const anon = await request.newContext({ baseURL: e2eBaseUrl() });
  const wrongPassword = { email: "nobody@culinaire.test", password: "wrong-password-1" };
  const old = await anon.post("/api/auth/login", { data: wrongPassword, headers: version("0.1.0") });
  expect(old.status()).toBe(426);
  expect(await old.json()).toMatchObject({ error: "Update the app to continue.", code: "upgrade_required", minVersion: "9.9.9" });

  const current = await anon.post("/api/auth/login", { data: wrongPassword, headers: version("99.0.0") });
  expect(current.status()).toBe(401); // got as far as the password
  const web = await anon.post("/api/auth/login", { data: wrongPassword });
  expect(web.status()).toBe(401);
  await anon.dispose();

  // The count download is gated; saving counts never is.
  const download = await api.get("/api/inventory/stock-takes/00000000-0000-4000-8000-000000000000/count-sheets", { headers: version("0.1.0") });
  expect(download.status()).toBe(426);
  const save = await api.post("/api/inventory/stock-takes/00000000-0000-4000-8000-000000000000/categories/Bar/lines", {
    data: { ingredientId: "00000000-0000-4000-8000-000000000000", rawQty: 1, countedUnit: "kg" },
    headers: version("0.1.0"),
  });
  expect(save.status()).not.toBe(426);

  // Back to "allow every version": the same old phone signs in again.
  await apiCall(api, "PUT", "/api/settings", { mobile_min_app_version: "0.0.0" });
  const again = await (await request.newContext({ baseURL: e2eBaseUrl() })).post("/api/auth/login", { data: wrongPassword, headers: version("0.1.0") });
  expect(again.status()).toBe(401);
});
