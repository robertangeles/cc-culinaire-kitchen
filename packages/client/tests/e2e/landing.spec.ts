/**
 * Landing page (docs/designs/landing-page-hospitality-redesign.md).
 * Public/unauthenticated — deliberately does not use the shared authenticated
 * storageState (test.use below overrides it per-file), since "/" must work
 * for a logged-out visitor.
 */
import { test, expect } from "@playwright/test";
import { STORAGE_STATE } from "./auth.setup.js";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Landing page", () => {
  test("renders hero, real kitchen photography, and the prep-plan headline", async ({ page }) => {
    await page.goto("/");
    const headline = page.getByRole("heading", { name: /your morning prep plan/i });
    await expect(headline).toBeVisible();
    // Headline text is split across per-word motion.span elements for the
    // stagger animation, so assert on combined text rather than getByText.
    await expect(headline).toContainText("Done");
    await expect(headline).toContainText("2");
    await expect(headline).toContainText("minutes");
    // Hero background photography (not the old radial-glow-only treatment).
    await expect(page.locator('[style*="hero-kitchen.webp"]')).toBeAttached();
  });

  test("primary CTA links to registration", async ({ page }) => {
    await page.goto("/");
    const cta = page.getByRole("link", { name: /start free trial/i }).first();
    await expect(cta).toHaveAttribute("href", "/register");
  });

  test("nav Log In link routes to /login", async ({ page }) => {
    await page.goto("/");
    // Both LandingNav and LandingFooter render a <nav> (two "navigation"
    // landmarks) — LandingNav is first in DOM order.
    await page.getByRole("navigation").first().getByRole("link", { name: /^log in$/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("featured customer trust strip shows a real customer, not category placeholders", async ({ page }) => {
    await page.goto("/");
    const strip = page.getByText("Featured customer");
    await strip.scrollIntoViewIfNeeded();
    await expect(strip).toBeVisible();
    await expect(page.getByText("Almost French Patisserie")).toBeVisible();
    await expect(page.getByRole("img", { name: /almost french patisserie logo/i })).toBeVisible();
    // The old generic category strip must be gone.
    await expect(page.getByText("Fine dining kitchens")).toHaveCount(0);
  });

  test("phone mockup shows the real product screenshot, not a fabricated prep list", async ({ page }) => {
    await page.goto("/");
    const screenshot = page.getByRole("img", { name: /inventory dashboard/i });
    await expect(screenshot).toBeVisible();
    // Corner badges quote real numbers visible in that same screenshot,
    // not fabricated ones (docs/designs/landing-page-hospitality-redesign.md).
    await expect(page.getByText("19 items — reorder now")).toBeVisible();
    await expect(page.getByText("3 of 4 steps complete")).toBeVisible();
  });

  test("mobile viewport: hamburger menu opens and CTA is reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Menu").click();
    await expect(page.getByRole("link", { name: /start free trial/i }).last()).toBeVisible();
  });

  test("mobile menu no longer links to #features or #pricing either", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByLabel("Menu").click();
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: /^features$/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^pricing$/i })).toHaveCount(0);
  });

  test("removed Pricing/GMSection content stays gone, independent of the nav-link checks", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/simple pricing\. no surprises/i)).toHaveCount(0);
    await expect(page.getByText(/the numbers that justify the \$97/i)).toHaveCount(0);
  });

  test("no console errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
  });

  test("nav no longer links to #features or #pricing (removed this session)", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: /^features$/i })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: /^pricing$/i })).toHaveCount(0);
  });

  test("footer: Pricing link removed (was a dead #pricing anchor after the section shipped out), Features link still works", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: /^pricing$/i })).toHaveCount(0);
    await expect(footer.getByRole("link", { name: /^features$/i })).toHaveAttribute("href", "#features");
  });
});

test.describe("Landing page — authenticated nav", () => {
  test.use({ storageState: STORAGE_STATE });

  test("signed-in, non-guest visitor sees Go to Dashboard instead of Start Free Trial", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    const dashboardCta = nav.getByRole("link", { name: /go to dashboard/i });
    await expect(dashboardCta).toBeVisible();
    await expect(dashboardCta).toHaveAttribute("href", "/chat/new");
    await expect(nav.getByRole("link", { name: /start free trial/i })).toHaveCount(0);
  });
});

test.describe("Landing page — mobile-first section", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("receiving mockup shows the real screenshot, not fabricated PO data", async ({ page }) => {
    await page.goto("/");
    const screenshot = page.getByRole("img", { name: /receiving checklist/i });
    await screenshot.scrollIntoViewIfNeeded();
    await expect(screenshot).toBeVisible();
    // The old fabricated "PO-2024-0847 · Sysco Foods" content must be gone.
    await expect(page.getByText("PO-2024-0847")).toHaveCount(0);
    await expect(page.getByText("Sysco Foods")).toHaveCount(0);
  });
});
