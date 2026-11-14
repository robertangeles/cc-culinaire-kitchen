/**
 * Changing two-factor settings needs proof, not just a session.
 *
 * The shared E2E account has MFA on. These specs act as someone holding only its session cookie
 * and try the takeover moves: replace the authenticator secret, switch MFA off. Every one must
 * be refused and MFA must still be on afterwards. Nothing here ever switches MFA off for real,
 * because every other spec signs in as this account.
 */
import { test, expect } from "./_helpers/test";

const password = process.env.E2E_USER_PASSWORD;

test("a session alone cannot replace the secret or switch MFA off, and the UI says why", async ({ page }) => {
  test.skip(!password, "E2E_USER_PASSWORD not set");
  const api = page.context().request;
  const mfaIsOn = async () => ((await (await api.get("/api/auth/me")).json()) as { user: { mfaEnabled: boolean } }).user.mfaEnabled;
  expect(await mfaIsOn()).toBe(true);

  // Setup would overwrite the live secret and lock the owner out: refused whatever is sent.
  for (const data of [{}, { password }]) {
    const setup = await api.post("/api/auth/mfa/setup", { data });
    expect(setup.status()).toBe(409);
    expect((await setup.json()).code).toBe("MFA_ALREADY_ENABLED");
  }

  // Disabling with nothing, or with the password but no authenticator code. Each refusal counts toward
  // the account's 5-failure MFA cap, and the account is shared by the whole run, so only the two main
  // takeover moves are probed here; wrong password and wrong code are covered by services/mfaProof.test.ts.
  const refusals: Array<[Record<string, string>, number, string]> = [
    [{}, 403, "INVALID_CREDENTIALS"],
    [{ password: password! }, 403, "MFA_REQUIRED"],
  ];
  for (const [data, status, code] of refusals) {
    const res = await api.post("/api/auth/mfa/disable", { data });
    expect({ status: res.status(), code: (await res.json()).code }).toEqual({ status, code });
  }
  expect(await mfaIsOn()).toBe(true);

  // Same through the page: the form asks for both factors and shows the server's reason.
  await page.goto("/profile");
  await page.getByRole("tab", { name: "Security" }).click();
  await page.getByRole("button", { name: "Disable MFA" }).click();
  await page.getByLabel("Your password").fill(password!);
  await page.getByLabel("Authenticator code").fill("000000");
  await page.getByRole("button", { name: "Turn off MFA" }).click();
  await expect(page.getByRole("alert")).toContainText("authenticator code is not valid");
  await expect(page.getByText("MFA is currently enabled on your account.")).toBeVisible();
  expect(await mfaIsOn()).toBe(true);
});
