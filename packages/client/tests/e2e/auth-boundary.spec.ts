/**
 * Logged-out boundary: with an empty session, no gated page is reachable and no
 * protected API answers. The logged-in specs prove permitted users get in; this
 * proves the opposite after the AuthError/guard refactors.
 *
 * A logged-out visitor is not sent to /login: ProtectedRoute starts a guest
 * session, then a gated route either bounces the guest to /chat/new
 * (AuthenticatedOnly) or shows the "This tool isn't on your plan" card
 * (RequirePermission). The server is the real boundary, so the API table is
 * the stronger half.
 */
import { test, expect } from "./_helpers/test";
import { ROUTES } from "./_helpers/routes";

test.use({ storageState: { cookies: [], origins: [] } });

for (const { path } of ROUTES.filter((r) => r.kind === "gated")) {
  test(`logged-out visit to ${path} is denied`, async ({ page }) => {
    await page.goto(path);
    await expect
      .poll(async () => /\/chat\/new/.test(page.url()) || (await page.getByText("This tool isn't on your plan").isVisible()), {
        message: `${path} must redirect to /chat/new or show the access-denied card`,
        timeout: 20_000,
      })
      .toBe(true);
  });
}

const PROTECTED_API: ReadonlyArray<{ method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string }> = [
  { method: "GET", path: "/api/users" },
  { method: "GET", path: "/api/organisations" },
  { method: "GET", path: "/api/roles" },
  { method: "GET", path: "/api/permissions" },
  { method: "GET", path: "/api/credentials" },
  { method: "GET", path: "/api/conversations" },
  { method: "GET", path: "/api/store-locations" },
  { method: "GET", path: "/api/inventory/stock" },
  { method: "GET", path: "/api/menu" },
  { method: "GET", path: "/api/waste" },
  { method: "GET", path: "/api/prep/tasks" },
  { method: "GET", path: "/api/roster/shifts" },
  { method: "GET", path: "/api/workforce" },
  { method: "GET", path: "/api/brain/memories" },
  { method: "GET", path: "/api/compliance/dashboard" },
  { method: "GET", path: "/api/knowledge" },
  { method: "GET", path: "/api/admin/site-pages" },
  { method: "GET", path: "/api/stripe/subscription" },
  { method: "GET", path: "/api/guides" },
  { method: "POST", path: "/api/roles" },
  { method: "POST", path: "/api/users" },
  { method: "POST", path: "/api/inventory/stock" },
  { method: "POST", path: "/api/roster/shifts" },
  { method: "POST", path: "/api/store-locations" },
  { method: "POST", path: "/api/knowledge" },
  { method: "POST", path: "/api/admin/site-pages" },
  { method: "PUT", path: "/api/settings" },
  { method: "PATCH", path: "/api/organisations/1" },
  { method: "DELETE", path: "/api/users/00000000-0000-0000-0000-000000000000" },
];

test("protected API endpoints return 401 with no session", async ({ request }) => {
  test.setTimeout(240_000);
  const failures: string[] = [];
  for (const { method, path } of PROTECTED_API) {
    let res = await request.fetch(path, { method, data: method === "GET" || method === "DELETE" ? undefined : {} });
    // Anonymous traffic is limited to 60/min per IP and the page tests above spend it; wait out the window.
    for (let attempt = 0; res.status() === 429 && attempt < 2; attempt++) {
      const resetSeconds = Number(/t=(\d+)/.exec(res.headers()["ratelimit"] ?? "")?.[1] ?? 60);
      await new Promise((resolve) => setTimeout(resolve, (resetSeconds + 1) * 1000));
      res = await request.fetch(path, { method, data: method === "GET" || method === "DELETE" ? undefined : {} });
    }
    if (res.status() !== 401) failures.push(`${method} ${path} -> ${res.status()}`);
  }
  expect(failures, "every protected endpoint must answer 401 to a logged-out caller").toEqual([]);
});

test("an invalid access token is rejected, not treated as logged-in", async ({ request }) => {
  const res = await request.get("/api/users", { headers: { Authorization: "Bearer not-a-real-token" } });
  expect(res.status()).toBe(401);
});
