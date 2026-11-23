import { describe, it, expect, vi } from "vitest";
import { authenticatorLink, createAccountApi, deleteAccountMessage, mfaMessage } from "./account";
import { ApiError, type ApiClient, type TokenStore } from "./client";

function setup(replies: unknown[], tokens: { accessToken: string; refreshToken: string } | null = { accessToken: "A", refreshToken: "R" }) {
  const request = vi.fn(async (_method: string, _path: string, options?: { schema?: { parse(d: unknown): unknown } }) => {
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return options?.schema ? options.schema.parse(reply) : reply;
  });
  const tokenStore: TokenStore = { load: vi.fn(async () => tokens), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) };
  return { api: createAccountApi({ request } as unknown as ApiClient, tokenStore), request };
}

describe("what the delete screen must ask for", () => {
  it("reads whether the account has a password and uses MFA", async () => {
    const { api, request } = setup([{ profile: { hasPassword: false, mfaEnabledInd: true, userEmail: "c@x.test", userName: "Chef" } }]);
    expect(await api.facts()).toEqual({ hasPassword: false, hasApple: false, mfaEnabled: true, email: "c@x.test" });
    expect(request).toHaveBeenCalledWith("GET", "/api/users/profile", expect.anything());
  });

  it("reads whether the account is linked to Apple, and takes no for an answer from a server that does not say", async () => {
    expect((await setup([{ profile: { hasPassword: false, hasApple: true, userEmail: "a@privaterelay.appleid.com" } }]).api.facts()).hasApple).toBe(true);
    expect((await setup([{ profile: { hasPassword: false, userEmail: "a@x.test" } }]).api.facts()).hasApple).toBe(false);
  });

  it("is a bad_response when the server does not say whether there is a password (asking for the wrong proof would be worse)", async () => {
    await expect(setup([{ profile: { userEmail: "c@x.test" } }]).api.facts()).rejects.toThrow();
  });
});

describe("deleting the account", () => {
  it("sends the proof and the refresh token (a Google-only account needs it for the 10-minute rule: a phone holds no cookie)", async () => {
    const { api, request } = setup([{ success: true }]);
    await api.deleteAccount({ confirmEmail: "c@x.test", mfaCode: "123456" });
    expect(request).toHaveBeenCalledWith("POST", "/api/users/delete-account", { body: { confirmEmail: "c@x.test", mfaCode: "123456", refreshToken: "R" } });
  });

  it("sends a password the same way", async () => {
    const { api, request } = setup([{ success: true }]);
    await api.deleteAccount({ password: "pw" });
    expect(request).toHaveBeenCalledWith("POST", "/api/users/delete-account", { body: { password: "pw", refreshToken: "R" } });
  });

  it("sends a fresh Apple sign-in as the proof (the server's names for it), for an account that signed in with Apple", async () => {
    const { api, request } = setup([{ success: true }]);
    await api.deleteAccount({ apple: { identityToken: "id-token", nonce: "n".repeat(64) } });
    expect(request).toHaveBeenCalledWith("POST", "/api/users/delete-account", { body: { appleIdentityToken: "id-token", appleNonce: "n".repeat(64), refreshToken: "R" } });
  });

  it("lets the server refuse a call with no tokens rather than guessing", async () => {
    const { api, request } = setup([{ success: true }], null);
    await api.deleteAccount({ password: "pw" });
    expect(request).toHaveBeenCalledWith("POST", "/api/users/delete-account", { body: { password: "pw", refreshToken: undefined } });
  });
});

describe("what a refusal says (by the server's code, never its English)", () => {
  const refusal = (serverCode: string, status = 403, message = "server words") => new ApiError("forbidden", message, status, undefined, serverCode);

  it("names the wrong proof", () => {
    expect(deleteAccountMessage(refusal("INVALID_CREDENTIALS"), "password")).toEqual({ text: "That password isn't right." });
    expect(deleteAccountMessage(refusal("INVALID_CREDENTIALS"), "email")).toEqual({ text: "That email doesn't match your account." });
    expect(deleteAccountMessage(refusal("INVALID_CREDENTIALS"), "apple")).toEqual({ text: "That Apple sign-in doesn't match this account." });
    expect(deleteAccountMessage(refusal("INVALID_MFA_CODE"), "password")).toEqual({ text: "That authenticator code isn't valid." });
  });

  it("asks for the authenticator code the server wants even when the profile did not say MFA was on", () => {
    expect(deleteAccountMessage(refusal("MFA_REQUIRED"), "password")).toEqual({ text: "Enter your authenticator code.", needsMfa: true });
  });

  it("sends a Google or Apple account that signed in long ago back to sign in again", () => {
    expect(deleteAccountMessage(refusal("RECENT_SIGN_IN_REQUIRED"), "email")).toEqual({ text: "For your security, sign out, sign back in, then delete your account.", needsFreshSignIn: true });
  });

  it("shows the server's own sentence when it says what to do first (it names the organisation)", () => {
    const message = "You are the only admin of Main Kitchen. Make another member an admin first, then delete your account.";
    expect(deleteAccountMessage(refusal("OWNERSHIP_TRANSFER_REQUIRED", 409, message), "password")).toEqual({ text: message });
    expect(deleteAccountMessage(refusal("LAST_ADMINISTRATOR", 409, "Make someone else an Administrator."), "password")).toEqual({ text: "Make someone else an Administrator." });
  });

  it("falls back to the plain sentence for a network or server failure", () => {
    expect(deleteAccountMessage(new ApiError("network"), "password")).toEqual({ text: "Can't reach the server. Try again." });
    expect(deleteAccountMessage(new Error("boom"), "password")).toEqual({ text: "Couldn't delete the account. Try again." });
  });
});

describe("profile details", () => {
  it("reads every field, an empty one as blank", async () => {
    const { api } = setup([{ profile: { userName: "Chef", userEmail: "c@x.test", userBio: null, userSuburb: "Fitzroy", userPhotoPath: null, hasPassword: true } }]);
    const d = await api.details();
    expect(d).toMatchObject({ userName: "Chef", userBio: "", userSuburb: "Fitzroy", userLinkedin: "", userEmail: "c@x.test", userPhotoPath: null });
  });

  it("uploads a picture as multipart `file` and answers where it is", async () => {
    const { api, request } = setup([{ photoPath: "https://img/a.jpg" }]);
    expect(await api.uploadAvatar({ uri: "file:///a.jpg", mimeType: "image/jpeg" })).toBe("https://img/a.jpg");
    const [method, path, options] = request.mock.calls[0] as unknown as [string, string, { body: FormData }];
    expect([method, path]).toEqual(["POST", "/api/users/profile/avatar"]);
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.has("file")).toBe(true);
  });
});

describe("password and two-step verification", () => {
  it("sends this sign-in's refresh token with a password change, so it stays signed in while the others end", async () => {
    const { api, request } = setup([{ success: true }]);
    await api.changePassword("old-one", "new-password");
    expect(request).toHaveBeenCalledWith("POST", "/api/users/change-password", { body: { currentPassword: "old-one", newPassword: "new-password", refreshToken: "R" } });
  });

  it("sends the proof and the refresh token to start or remove two-step verification", async () => {
    const { api, request } = setup([{ secret: "ABC", qrCodeDataUrl: "data:image/png;base64,x" }, { message: "ok" }, { message: "ok" }]);
    expect(await api.mfaSetup({ password: "pw" })).toEqual({ secret: "ABC", qrCodeDataUrl: "data:image/png;base64,x" });
    expect(request.mock.calls[0][2]).toMatchObject({ body: { password: "pw", refreshToken: "R" } });
    await api.mfaEnable("123456");
    expect(request.mock.calls[1].slice(0, 3)).toEqual(["POST", "/api/auth/mfa/enable", { body: { token: "123456" } }]);
    await api.mfaDisable({ password: "pw", mfaCode: "654321" });
    expect(request.mock.calls[2][2]).toMatchObject({ body: { password: "pw", mfaCode: "654321", refreshToken: "R" } });
  });

  it("explains each refusal by the server's code", () => {
    const coded = (code: string, status = 403) => new ApiError("forbidden", "English", status, { code }, code);
    expect(mfaMessage(coded("INVALID_CREDENTIALS")).text).toBe("That password isn't right.");
    expect(mfaMessage(coded("MFA_REQUIRED")).needsMfa).toBe(true);
    expect(mfaMessage(coded("RECENT_SIGN_IN_REQUIRED")).needsFreshSignIn).toBe(true);
    expect(mfaMessage(new ApiError("bad_request", "Invalid code. Please try again.", 400)).text).toMatch(/newest code/);
    expect(mfaMessage(new Error("boom")).text).toBe("Something went wrong. Try again.");
  });

  it("builds the authenticator link with the server's issuer and the account's email", () => {
    expect(authenticatorLink("JBSWY3DP", "c@x.test")).toBe("otpauth://totp/CulinAIre%20Kitchen%3Ac%40x.test?secret=JBSWY3DP&issuer=CulinAIre%20Kitchen");
  });
});

describe("kitchen profile", () => {
  it("reads a profile never saved as the defaults", async () => {
    const { api } = setup([{}]);
    expect(await api.kitchenProfile()).toMatchObject({ skillLevel: "home_cook", servingsDefault: 4, cuisinePreferences: [], restaurantName: "" });
  });

  it("drops an option row it cannot read instead of failing the list", async () => {
    const { api } = setup([{ skill_level: [{ optionValue: "line_cook", optionLabel: "Line cook", optionDescription: null }, { broken: true }], cuisine: [], dietary: [], equipment: [] }]);
    expect((await api.personalisationOptions()).skill_level).toEqual([{ optionValue: "line_cook", optionLabel: "Line cook", optionDescription: null }]);
  });
});
