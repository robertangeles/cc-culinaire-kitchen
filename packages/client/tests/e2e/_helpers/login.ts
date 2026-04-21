import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function loginAsTestUser(page: Page) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  expect(email, "E2E_USER_EMAIL must be set in packages/client/.env.test").toBeTruthy();
  expect(password, "E2E_USER_PASSWORD must be set in packages/client/.env.test").toBeTruthy();

  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"], input[name="email"]', email!);
  await page.fill('input[type="password"], input[name="password"]', password!);

  // Submit and wait for the location-context API to come back 200 in parallel.
  // LocationContext fetches it on mount and silently swallows errors — if we
  // navigate away before it succeeds, hasLocationAccess stays false and the
  // LocationGate renders the "no location" screen instead of the real page.
  const locationContextResponse = page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/users/location-context") && resp.status() === 200,
    { timeout: 15_000 },
  );
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(chat|inventory|bench)/, { timeout: 10_000 });
  await locationContextResponse;
}
