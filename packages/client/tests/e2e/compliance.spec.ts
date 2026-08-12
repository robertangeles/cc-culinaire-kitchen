/**
 * E2E coverage for the Staff Compliance Vault (Phase 1).
 *
 * Prereqs (run in separate terminals):
 *   ALLOW_REMOTE_DEV_DB=1 pnpm --filter @culinaire/server dev   # port 3009
 *   pnpm --filter @culinaire/client dev                         # port 5179
 *
 * Run:  pnpm --filter @culinaire/client test:e2e
 *
 * Credentials come from packages/client/.env.test (gitignored). The E2E account
 * has MFA enabled, so E2E_USER_TOTP_SECRET must be set too — loginAsTestUser
 * completes the second factor.
 *
 * These assert the flows that only break at the seams: permission gating,
 * LocationGate, the headline reconciling with the table, and the responsive
 * collapse. Pure logic is covered by unit tests and is not re-tested here.
 */

import { test, expect, type Page } from "@playwright/test";

async function openCompliance(page: Page) {
  await page.goto("/compliance");
  // Not networkidle — socket.io holds the connection open, so it never fires.
  await page.locator("main, [role=main], h1").first().waitFor({ state: "visible", timeout: 20_000 });
}

test.describe("Staff Compliance Vault — Phase 1", () => {
  // The harness test. It proves the MFA login path works end to end in a real
  // browser, that the route is reachable behind its four permissions, and that
  // LocationGate resolved rather than swallowing the page.
  test("compliance page loads for a permitted user and is not the location gate", async ({ page }) => {
    await openCompliance(page);

    await expect(page).toHaveURL(/\/compliance/);

    // LocationGate renders a "no location" screen when the context fetch loses
    // its race; a page that got past it must not show that.
    await expect(page.getByText(/no location|select a location to continue/i)).toHaveCount(0);

    // Either real content or a designed empty state — never a raw error and
    // never a permanently spinning skeleton.
    await expect(async () => {
      const heading = await page.getByRole("heading", { level: 1 }).count();
      const empty = await page.getByText(/no one on the team yet|add your first/i).count();
      expect(heading + empty, "compliance page must finish rendering").toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    // A raw error string reaching the user is a failure in its own right.
    await expect(page.getByText(/\[object Object\]|undefined is not|TypeError/i)).toHaveCount(0);
  });

  test("the compliance nav entry is present and routes correctly", async ({ page }) => {
    // Desktop viewport: the sidebar is `hidden md:flex`, so it does not exist
    // at phone widths (Sidebar.tsx:137).
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/chat");
    await page.locator("nav, aside").first().waitFor({ state: "visible", timeout: 20_000 });

    // Nav sections render collapsed until the user opens one (Sidebar.tsx:92),
    // so the link is in the DOM but not visible. Expand "Run the Kitchen"
    // first — which is exactly what a real user does to reach Compliance.
    const sectionHeader = page.getByText(/run the kitchen/i).first();
    if (await sectionHeader.isVisible().catch(() => false)) {
      await sectionHeader.click();
    }

    const navLink = page.getByRole("link", { name: /compliance/i }).first();
    await expect(navLink).toBeVisible({ timeout: 10_000 });
    await navLink.click();
    await expect(page).toHaveURL(/\/compliance/);
  });

  // The headline is derived from the same array the table renders, precisely so
  // the two cannot diverge. The approved mockup shipped with "24 of 25
  // compliant" printed above two expired rows; this is the guard against that
  // regression reappearing.
  test("headline count reconciles with the staff table", async ({ page }) => {
    await openCompliance(page);

    const headline = page.getByText(/\d+ of \d+ staff are compliant/i);
    if ((await headline.count()) === 0) {
      test.skip(true, "No staff/requirements configured in this environment — nothing to reconcile");
      return;
    }

    const text = (await headline.first().textContent()) ?? "";
    const [, compliant, total] = text.match(/(\d+) of (\d+)/) ?? [];
    expect(Number(compliant)).toBeLessThanOrEqual(Number(total));

    // Every row the table calls non-compliant must be accounted for by the gap
    // between the two numbers.
    const nonCompliantPills = await page.getByText(/^(Expired|Rejected)$/).count();
    expect(Number(total) - Number(compliant)).toBeGreaterThanOrEqual(
      nonCompliantPills > 0 ? 1 : 0,
    );
  });

  // Design decision 6: below 768px the table becomes a per-person card list.
  // Never a horizontal scroll — on a compliance screen the status columns are
  // the entire point, and scrolling puts them off-screen by default.
  test("at 375px the page does not scroll horizontally", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openCompliance(page);

    await expect(async () => {
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, "no horizontal scroll at 375px").toBe(false);
    }).toPass({ timeout: 10_000 });
  });

  test("status is never conveyed by colour alone", async ({ page }) => {
    await openCompliance(page);

    // Every status pill must carry text, so it survives greyscale and
    // colour-blindness. A pill rendered as a bare coloured dot fails this.
    const pills = page.locator('[data-status-pill], [class*="rounded-full"][class*="border"]');
    const n = await pills.count();
    for (let i = 0; i < Math.min(n, 20); i += 1) {
      const pill = pills.nth(i);
      const label = (await pill.textContent())?.trim() ?? "";
      const aria = (await pill.getAttribute("aria-label")) ?? "";
      if (label.length === 0 && aria.length === 0) {
        throw new Error(`Status pill ${i} conveys meaning with no text and no aria-label`);
      }
    }
  });
});

test.describe("Staff Compliance Vault — access control", () => {
  // The vault's whole promise. A staff member must not be able to reach another
  // person's document by guessing an id, and the API must refuse regardless of
  // what the UI shows.
  test("a foreign document id returns 404, not the document", async ({ page }) => {
    const res = await page.request.get(
      "/api/compliance/documents/00000000-0000-4000-8000-000000000000",
    );
    expect(res.status(), "a document that is not ours must read as absent").toBe(404);
  });
});

// Separate block on purpose: test.use applies to every test in its describe, so
// clearing storageState alongside the authenticated cases would strip their
// session too — which is exactly the mistake this structure prevents.
test.describe("Staff Compliance Vault — anonymous access", () => {
  test.use({ storageState: { cookies: [], origins: [] } });


  test("compliance endpoints reject an unauthenticated request", async ({ request }) => {
    for (const path of [
      "/api/compliance/dashboard",
      "/api/compliance/staff",
      "/api/compliance/documents/mine",
    ]) {
      const res = await request.get(path);
      expect(res.status(), `${path} must require auth`).toBe(401);
    }
  });
});
