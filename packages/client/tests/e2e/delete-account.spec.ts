/**
 * A signed-in user deletes their own account from Profile -> Security.
 *
 * Uses a dedicated throwaway user (E2E_DELETE_USER_*, seeded by seedE2eCiData.ts), never the
 * shared E2E account every other spec depends on. The account is deleted for good, so the
 * spec runs once per database; CI starts from an empty one every run.
 */
import { test, expect } from "./_helpers/test";

const email = process.env.E2E_DELETE_USER_EMAIL;
const password = process.env.E2E_DELETE_USER_PASSWORD;

test.use({ storageState: { cookies: [], origins: [] } });

test("a user deletes their own account: wrong password is refused, right password signs them out for good", async ({ page }) => {
  test.skip(!email || !password, "E2E_DELETE_USER_EMAIL / E2E_DELETE_USER_PASSWORD not set (CI sets them)");

  const api = page.context().request;
  const login = await api.post("/api/auth/login", { data: { email, password } });
  expect(login.ok(), `login failed (${login.status()})`).toBe(true);

  await page.goto("/profile");
  await page.getByRole("tab", { name: "Security" }).click();
  await page.getByRole("button", { name: "Delete my account" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Wrong password: refused, still signed in, dialog stays open.
  await dialog.getByLabel("Your password").fill("definitely-not-the-password");
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Incorrect password");
  expect((await api.get("/api/auth/me")).ok()).toBe(true);

  // Right password: account deleted, session gone, sign-in impossible.
  await dialog.getByLabel("Your password").fill(password!);
  await dialog.getByRole("button", { name: "Delete my account" }).click();
  await expect(page).toHaveURL(/\/$|\/chat\/new/, { timeout: 20_000 });

  expect((await api.get("/api/auth/me")).ok()).toBe(false);
  const again = await api.post("/api/auth/login", { data: { email, password } });
  expect(again.status()).toBe(401);
});
