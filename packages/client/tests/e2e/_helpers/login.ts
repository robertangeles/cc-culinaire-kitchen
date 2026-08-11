import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { generate } from "otplib";

/**
 * Sign in as the E2E user, via the API rather than the login form.
 *
 * WHY NOT DRIVE THE UI. The Sign In button is disabled until Cloudflare
 * Turnstile yields a token (`LoginPage.tsx`: `disabled={isSubmitting ||
 * !turnstileToken}`). Turnstile is hard-enforced and fail-closed by design, and
 * a headless browser in dev never gets a token, so the button never enables and
 * every UI login burns its full timeout. Driving a third-party bot check is also
 * not what these tests are for — they are here to exercise OUR screens.
 *
 * Authenticating through the API and letting the response cookies land in the
 * browser context gives a real, fully-authenticated session, deterministically
 * and in a fraction of the time. `page.context().request` shares its cookie jar
 * with the page, so a subsequent `page.goto` is authenticated.
 *
 * MFA. The E2E account has MFA enabled, so `/api/auth/login` returns
 * `requiresMfa` plus a short-lived session token rather than a session. We
 * generate the TOTP from `E2E_USER_TOTP_SECRET` and complete
 * `/api/auth/mfa/verify`. Accounts without MFA return a session directly and
 * skip that step.
 *
 * NEVER `waitForLoadState("networkidle")` IN THIS APP: BenchSocketContext holds
 * a socket.io connection open, so the network never goes idle and that wait
 * always times out. Wait for a concrete element instead.
 */
export async function loginAsTestUser(page: Page) {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  const totpSecret = process.env.E2E_USER_TOTP_SECRET;

  expect(email, "E2E_USER_EMAIL must be set in packages/client/.env.test").toBeTruthy();
  expect(password, "E2E_USER_PASSWORD must be set in packages/client/.env.test").toBeTruthy();

  // Shares a cookie jar with the page, so the session it establishes is the
  // session the browser then uses.
  const api = page.context().request;

  const loginRes = await api.post("/api/auth/login", { data: { email, password } });
  expect(
    loginRes.ok(),
    `login failed (${loginRes.status()}). Is the API running on :3009 and are the ` +
      `credentials in packages/client/.env.test correct?`,
  ).toBe(true);

  const body = (await loginRes.json()) as {
    requiresMfa?: boolean;
    mfaSessionToken?: string;
  };

  if (body.requiresMfa) {
    expect(
      totpSecret,
      "This account has MFA enabled. Set E2E_USER_TOTP_SECRET in packages/client/.env.test, " +
        "or point E2E at an account without MFA.",
    ).toBeTruthy();

    // A TOTP is single-use and only valid inside its 30-second window. Tests run
    // sequentially, so two logins can easily land in the SAME window and produce
    // the same code — which the server correctly rejects as a replay. That is
    // the server behaving properly, not a broken secret, so on a rejection we
    // wait out the window and try the next code exactly once.
    //
    // Generated at the moment of use, never earlier: a code computed before the
    // request can already have expired by the time it arrives.
    let verifyRes = await api.post("/api/auth/mfa/verify", {
      data: { mfaSessionToken: body.mfaSessionToken, code: await generate({ secret: totpSecret! }) },
    });

    if (!verifyRes.ok()) {
      await new Promise((r) => setTimeout(r, 31_000));
      // The session token outlives one window (5 min), so it is still valid.
      verifyRes = await api.post("/api/auth/mfa/verify", {
        data: {
          mfaSessionToken: body.mfaSessionToken,
          code: await generate({ secret: totpSecret! }),
        },
      });
    }

    expect(
      verifyRes.ok(),
      `MFA verification failed (${verifyRes.status()}) even after waiting for a fresh ` +
        `TOTP window. Is E2E_USER_TOTP_SECRET the current secret for this account?`,
    ).toBe(true);
  }

  // Deliberately no extra verification round-trip here. Reaching this point
  // means /api/auth/login and /api/auth/mfa/verify both returned 2xx and their
  // Set-Cookie headers landed in the shared context jar; the tests themselves
  // then exercise the session. An extra probe only spends budget inside the
  // per-test timeout for a fact already established.
}
