/**
 * Post-refactor smoke: every client route renders for the authenticated E2E user.
 * Asserts only what a refactor can break wholesale: a blank screen, a raw error
 * string, or a gated page bouncing the Administrator away. The error-guard
 * fixture additionally fails any test on an uncaught page error or /api 5xx.
 */
import { test, expect } from "./_helpers/test";
import { ROUTES } from "./_helpers/routes";

for (const { path, kind } of ROUTES) {
  test(`${kind} route ${path} renders`, async ({ page }) => {
    await page.goto(path);

    // Not networkidle — socket.io holds the connection open.
    await expect
      .poll(async () => (await page.locator("body").innerText()).trim().length, {
        message: `${path} must render visible content, not a blank screen`,
        timeout: 20_000,
      })
      .toBeGreaterThan(20);

    await expect(page.getByText(/\[object Object\]|undefined is not|TypeError/i)).toHaveCount(0);

    if (kind === "gated") {
      await expect(page, "Administrator must not be bounced from a gated page").toHaveURL(new RegExp(`${path}(\\?|$|/)`));
    }
  });
}
