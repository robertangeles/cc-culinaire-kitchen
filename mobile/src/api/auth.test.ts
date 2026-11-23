import { describe, it, expect, vi } from "vitest";
import { createAuthApi, linkAppleMessage } from "./auth";
import { ApiError, type ApiClient, type TokenStore } from "./client";

const user = { userId: 7, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };

function setup(replies: unknown[]) {
  // Like the real client, run the reply through the schema the call asks for.
  const request = vi.fn(async (_method: string, _path: string, options?: { schema?: { parse(d: unknown): unknown } }) => {
    const reply = replies.shift();
    return options?.schema ? options.schema.parse(reply) : reply;
  });
  const tokenStore: TokenStore = { load: vi.fn(async () => ({ accessToken: "A", refreshToken: "R" })), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  return { api: createAuthApi({ request } as unknown as ApiClient, tokenStore), request, tokenStore };
}

describe("sign in", () => {
  it("saves the tokens and returns the user when no second step is needed", async () => {
    const { api, request, tokenStore } = setup([{ user, tokens: { accessToken: "A1", refreshToken: "R1" } }]);
    expect(await api.signIn("c@x.test", "pw")).toEqual({ status: "signedIn", user });
    expect(request).toHaveBeenCalledWith("POST", "/api/auth/login", expect.objectContaining({ body: { email: "c@x.test", password: "pw" }, auth: false }));
    expect(tokenStore.save).toHaveBeenCalledWith({ accessToken: "A1", refreshToken: "R1" });
  });

  it("asks for the six-digit code and saves nothing when the account uses MFA", async () => {
    const { api, tokenStore } = setup([{ requiresMfa: true, mfaSessionToken: "M" }]);
    expect(await api.signIn("c@x.test", "pw")).toEqual({ status: "mfa", mfaSessionToken: "M" });
    expect(tokenStore.save).not.toHaveBeenCalled();
  });

  it("finishes the MFA step with the session token and code, then saves the tokens", async () => {
    const { api, request, tokenStore } = setup([{ user, tokens: { accessToken: "A2", refreshToken: "R2" } }]);
    expect(await api.verifyMfa("M", "123456")).toEqual(user);
    expect(request).toHaveBeenCalledWith("POST", "/api/auth/mfa/verify", expect.objectContaining({ body: { mfaSessionToken: "M", code: "123456" }, auth: false }));
    expect(tokenStore.save).toHaveBeenCalledWith({ accessToken: "A2", refreshToken: "R2" });
  });
});

describe("google sign-in", () => {
  it("trades a Google ID token for a session, saving the tokens like a password sign-in", async () => {
    const { api, request, tokenStore } = setup([{ user, tokens: { accessToken: "G1", refreshToken: "GR1" } }]);
    expect(await api.googleSignIn("ID-TOKEN")).toEqual({ status: "signedIn", user });
    expect(request).toHaveBeenCalledWith("POST", "/api/auth/google/idtoken", expect.objectContaining({ body: { idToken: "ID-TOKEN" }, auth: false }));
    expect(tokenStore.save).toHaveBeenCalledWith({ accessToken: "G1", refreshToken: "GR1" });
  });

  it("asks for the six-digit code when the Google account uses MFA", async () => {
    const { api, tokenStore } = setup([{ requiresMfa: true, mfaSessionToken: "M" }]);
    expect(await api.googleSignIn("ID-TOKEN")).toEqual({ status: "mfa", mfaSessionToken: "M" });
    expect(tokenStore.save).not.toHaveBeenCalled();
  });
});

describe("accounts", () => {
  it("registers with name, email and password, and signs nobody in", async () => {
    const { api, request, tokenStore } = setup([{ userId: 9, message: "Registration successful.", autoVerified: false }]);
    expect(await api.register("Chef", "c@x.test", "Str0ng!pass")).toEqual({ autoVerified: false });
    expect(request).toHaveBeenCalledWith("POST", "/api/auth/register", expect.objectContaining({ body: { name: "Chef", email: "c@x.test", password: "Str0ng!pass" }, auth: false }));
    expect(tokenStore.save).not.toHaveBeenCalled();
  });

  it("asks for a password-reset email and a fresh verification email", async () => {
    const { api, request } = setup([{}, {}]);
    await api.forgotPassword("c@x.test");
    expect(request).toHaveBeenLastCalledWith("POST", "/api/auth/forgot-password", { body: { email: "c@x.test" }, auth: false });
    await api.resendVerification("c@x.test");
    expect(request).toHaveBeenLastCalledWith("POST", "/api/auth/resend-verification", { body: { email: "c@x.test" }, auth: false });
  });
});

describe("session and location", () => {
  it("reads the current user from /auth/me", async () => {
    const { api } = setup([{ user }]);
    expect(await api.me()).toEqual(user);
  });

  it("signs out on the server best-effort and always clears the device tokens", async () => {
    const failing = setup([]);
    failing.request.mockRejectedValueOnce(new Error("offline"));
    await api_signOut(failing);

    const ok = setup([{}]);
    await api_signOut(ok);
    expect(ok.request).toHaveBeenCalledWith("POST", "/api/auth/logout", expect.objectContaining({ body: { refreshToken: "R" }, auth: false }));
  });

  it("reads the location context and switches location", async () => {
    const ctx = { locations: [], selectedLocationId: null, organisationId: 1, isOrgAdmin: false, hasLocationAccess: true };
    const { api, request } = setup([ctx, { success: true, selectedLocationId: "L1" }]);
    expect(await api.locationContext()).toEqual(ctx);
    await api.selectLocation("L1");
    expect(request).toHaveBeenLastCalledWith("PATCH", "/api/users/selected-location", { body: { storeLocationId: "L1" } });
  });
});

async function api_signOut(s: ReturnType<typeof setup>) {
  await s.api.signOut();
  expect(s.tokenStore.clear).toHaveBeenCalled();
}

describe("a reply this app version cannot use", () => {
  it("is a bad_response, not a crash, when a sign-in reply has no tokens or an MFA reply has no session token", async () => {
    await expect(setup([{ user }]).api.signIn("c@x.test", "pw")).rejects.toMatchObject({ code: "bad_response" });
    await expect(setup([{ requiresMfa: true }]).api.signIn("c@x.test", "pw")).rejects.toMatchObject({ code: "bad_response" });
  });

  it("ignores fields it does not know and still signs in", async () => {
    const { api } = setup([{ user: { ...user, newThing: 1 }, tokens: { accessToken: "A", refreshToken: "R", expiresIn: 900 }, banner: "hi" }]);
    expect(await api.signIn("c@x.test", "pw")).toEqual({ status: "signedIn", user });
  });
});

describe("apple sign-in", () => {
  const credential = { identityToken: "APPLE-TOKEN", nonce: "n".repeat(32), authorizationCode: "CODE", givenName: "Ada", familyName: "Lovelace" };

  it("sends the credential as given and saves the tokens like a password sign-in", async () => {
    const { api, request, tokenStore } = setup([{ user, tokens: { accessToken: "P1", refreshToken: "PR1" } }]);
    expect(await api.appleSignIn(credential)).toEqual({ status: "signedIn", user });
    expect(request).toHaveBeenCalledWith("POST", "/api/auth/apple/idtoken", expect.objectContaining({ body: credential, auth: false }));
    expect(tokenStore.save).toHaveBeenCalledWith({ accessToken: "P1", refreshToken: "PR1" });
  });

  it("asks for the six-digit code and saves nothing when the account uses MFA", async () => {
    const { api, tokenStore } = setup([{ requiresMfa: true, mfaSessionToken: "M" }]);
    expect(await api.appleSignIn(credential)).toEqual({ status: "mfa", mfaSessionToken: "M" });
    expect(tokenStore.save).not.toHaveBeenCalled();
  });
});

describe("adding Apple to a signed-in account", () => {
  const credential = { identityToken: "APPLE-TOKEN", nonce: "n".repeat(32), authorizationCode: "CODE" };

  it("sends the credential, the proof and the refresh token (the server finds when this sign-in began from it)", async () => {
    const { api, request, tokenStore } = setup([{ linked: true }]);
    await api.linkApple(credential, { password: "pw", mfaCode: "123456" });
    expect(request).toHaveBeenCalledWith("POST", "/api/auth/apple/link", expect.objectContaining({ body: { ...credential, password: "pw", mfaCode: "123456", refreshToken: "R" } }));
    expect(request.mock.calls[0]?.[2]).not.toHaveProperty("auth", false);
    expect(tokenStore.save).not.toHaveBeenCalled();
  });

  it("sends no proof fields the person did not give", async () => {
    const { api, request } = setup([{ linked: true }]);
    await api.linkApple(credential, {});
    expect(request.mock.calls[0]?.[2]).toMatchObject({ body: { ...credential, refreshToken: "R" } });
    expect(Object.keys((request.mock.calls[0]?.[2] as { body: object }).body)).not.toContain("password");
  });
});

describe("linkAppleMessage", () => {
  const refused = (code: string, status = 403) => new ApiError("forbidden", "server words", status, undefined, code);

  it.each([
    ["INVALID_CREDENTIALS", "That password isn't right."],
    ["MFA_REQUIRED", "Enter your authenticator code."],
    ["INVALID_MFA_CODE", "That authenticator code isn't valid."],
    ["APPLE_ALREADY_LINKED", "That Apple ID is already used by another account, or this account already has a different one."],
    ["APPLE_TOKEN_INVALID", "Apple sign-in didn't work. Try again."],
    ["APPLE_NOT_CONFIGURED", "Sign in with Apple isn't available right now. Try again later."],
    ["APPLE_UNAVAILABLE", "Sign in with Apple isn't available right now. Try again later."],
    ["RATE_LIMITED", "Too many tries. Wait a few minutes and try again."],
  ])("explains %s in one plain sentence", (code, text) => {
    expect(linkAppleMessage(refused(code)).text).toBe(text);
  });

  it("asks for an authenticator code and a fresh sign-in where those are the way forward", () => {
    expect(linkAppleMessage(refused("MFA_REQUIRED"))).toMatchObject({ needsMfa: true });
    expect(linkAppleMessage(refused("RECENT_SIGN_IN_REQUIRED"))).toMatchObject({ needsFreshSignIn: true });
  });

  it("does not show a stranger's words for an error it cannot name", () => {
    expect(linkAppleMessage(new ApiError("network")).text).toBe("Couldn't add Sign in with Apple. Try again.");
    expect(linkAppleMessage(new Error("boom")).text).toBe("Couldn't add Sign in with Apple. Try again.");
  });
});
