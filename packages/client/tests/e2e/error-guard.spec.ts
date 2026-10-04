/**
 * Proves the global guard in _helpers/test.ts. Each test deliberately triggers
 * the failure the guard exists to catch, and test.fail() makes Playwright
 * report the test as passing only if the guard turned it red. If the guard
 * stops working, these start failing.
 */
import { test } from "./_helpers/test";

test.describe("background error guard", () => {
  test("an /api 5xx fails an otherwise passing test", async ({ page }) => {
    test.fail();
    await page.route("**/api/health", (route) => route.fulfill({ status: 500, body: "boom" }));
    await page.goto("/");
    await page.evaluate(() => fetch("/api/health"));
  });

  test("an uncaught page error fails an otherwise passing test", async ({ page }) => {
    test.fail();
    await page.goto("/");
    const errored = page.waitForEvent("pageerror");
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("injected uncaught error");
      }, 0);
    });
    await errored;
  });

  test("a 401 does not fail the test", async ({ page }) => {
    await page.route("**/api/health", (route) => route.fulfill({ status: 401, body: "no" }));
    await page.goto("/");
    await page.evaluate(() => fetch("/api/health"));
  });
});
