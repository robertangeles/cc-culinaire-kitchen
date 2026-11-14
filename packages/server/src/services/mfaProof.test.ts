import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

/**
 * requireProofToChangeMfa guards the account-takeover lever (a new secret locks the owner out, turning
 * MFA off removes the second factor). mfaChange.integration.test.ts covers it against a real database,
 * but a plain `pnpm test` skips that, so these run it through generateMfaSecret and disableMfa with the
 * database mocked. Each denial case also asserts nothing was written.
 */
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, writes: [] as Record<string, unknown>[], codeIsValid: true }));

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => [state.row] }) }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          state.writes.push(values);
        },
      }),
    }),
  },
}));
vi.mock("otplib", () => ({
  generateSecret: () => "NEWSECRET",
  generateURI: () => "otpauth://totp/x",
  verify: async () => ({ valid: state.codeIsValid }),
}));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,x" } }));
vi.mock("./emailService.js", () => ({}));
vi.mock("./piiService.js", () => ({}));
vi.mock("./settingsService.js", () => ({}));

import { generateMfaSecret, disableMfa, mfaSessionUserId } from "./authService.js";

const PASSWORD = "correct horse battery";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);
const justNow = () => new Date();
const longAgo = () => new Date(Date.now() - 60 * 60 * 1000);

function account(over: Record<string, unknown> = {}) {
  state.row = {
    userId: 1,
    userEmail: "chef@example.test",
    userPasswordHash: passwordHash,
    mfaEnabledInd: false,
    mfaSecret: null,
    ...over,
  };
}

beforeEach(() => {
  state.writes = [];
  state.codeIsValid = true;
  account();
});

describe("generateMfaSecret: proof required to start setup", () => {
  it("refuses a password account with no password, and writes nothing", async () => {
    await expect(generateMfaSecret(1, {}, justNow())).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", statusCode: 403 });
    expect(state.writes).toEqual([]);
  });

  it("refuses a wrong password, and writes nothing", async () => {
    await expect(generateMfaSecret(1, { password: "nope" }, justNow())).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(state.writes).toEqual([]);
  });

  it("accepts the right password and stores a pending secret", async () => {
    const out = await generateMfaSecret(1, { password: PASSWORD }, null);
    expect(out.secret).toBe("NEWSECRET");
    expect(state.writes[0]).toMatchObject({ mfaSecret: "NEWSECRET" });
  });

  it("refuses a Google-only account whose sign-in is stale or unknown, and writes nothing", async () => {
    account({ userPasswordHash: null });
    await expect(generateMfaSecret(1, {}, longAgo())).rejects.toMatchObject({ code: "RECENT_SIGN_IN_REQUIRED" });
    await expect(generateMfaSecret(1, {}, null)).rejects.toMatchObject({ code: "RECENT_SIGN_IN_REQUIRED" });
    expect(state.writes).toEqual([]);
  });

  it("accepts a Google-only account that signed in just now", async () => {
    account({ userPasswordHash: null });
    await expect(generateMfaSecret(1, {}, justNow())).resolves.toMatchObject({ secret: "NEWSECRET" });
  });

  it("never replaces the secret under an account with MFA already on (409, before any proof)", async () => {
    account({ mfaEnabledInd: true, mfaSecret: "LIVE" });
    await expect(generateMfaSecret(1, { password: PASSWORD }, justNow())).rejects.toMatchObject({
      code: "MFA_ALREADY_ENABLED",
      statusCode: 409,
    });
    expect(state.writes).toEqual([]);
  });
});

describe("disableMfa: proof required to remove the second factor", () => {
  beforeEach(() => account({ mfaEnabledInd: true, mfaSecret: "LIVE" }));

  it("needs the authenticator code even when the password is right", async () => {
    await expect(disableMfa(1, { password: PASSWORD }, justNow())).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(state.writes).toEqual([]);
  });

  it("refuses a wrong password before looking at the code", async () => {
    await expect(disableMfa(1, { password: "nope", mfaCode: "123456" }, justNow())).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(state.writes).toEqual([]);
  });

  it("refuses a wrong authenticator code", async () => {
    state.codeIsValid = false;
    await expect(disableMfa(1, { password: PASSWORD, mfaCode: "000000" }, justNow())).rejects.toMatchObject({
      code: "INVALID_MFA_CODE",
    });
    expect(state.writes).toEqual([]);
  });

  it("with the right password and code, turns MFA off and clears the secret", async () => {
    await disableMfa(1, { password: PASSWORD, mfaCode: "123456" }, null);
    expect(state.writes[0]).toMatchObject({ mfaEnabledInd: false, mfaSecret: null });
  });

  it("Google-only + MFA on + valid code + recent sign-in: succeeds", async () => {
    account({ userPasswordHash: null, mfaEnabledInd: true, mfaSecret: "LIVE" });
    await disableMfa(1, { mfaCode: "123456" }, justNow());
    expect(state.writes[0]).toMatchObject({ mfaEnabledInd: false, mfaSecret: null });
  });

  it("Google-only + MFA on + valid code but stale sign-in: refused, a code alone is not enough", async () => {
    account({ userPasswordHash: null, mfaEnabledInd: true, mfaSecret: "LIVE" });
    await expect(disableMfa(1, { mfaCode: "123456" }, longAgo())).rejects.toMatchObject({ code: "RECENT_SIGN_IN_REQUIRED" });
    expect(state.writes).toEqual([]);
  });

  it("Google-only + MFA on + recent sign-in but no code: refused", async () => {
    account({ userPasswordHash: null, mfaEnabledInd: true, mfaSecret: "LIVE" });
    await expect(disableMfa(1, {}, justNow())).rejects.toMatchObject({ code: "MFA_REQUIRED" });
    expect(state.writes).toEqual([]);
  });
});

describe("mfaSessionUserId: only a verified MFA token names an account", () => {
  const secret = () => process.env.JWT_ACCESS_SECRET ?? "dev-mfa-secret";

  it("returns the user of a valid MFA session token", () => {
    expect(mfaSessionUserId(jwt.sign({ sub: 7, purpose: "mfa" }, secret(), { expiresIn: "5m" }))).toBe(7);
  });

  it("returns null for a forged, expired, wrong-purpose or non-string token", () => {
    expect(mfaSessionUserId(jwt.sign({ sub: 7, purpose: "mfa" }, "some-other-secret"))).toBeNull();
    expect(mfaSessionUserId(jwt.sign({ sub: 7, purpose: "mfa" }, secret(), { expiresIn: -10 }))).toBeNull();
    expect(mfaSessionUserId(jwt.sign({ sub: 7, purpose: "access" }, secret()))).toBeNull();
    expect(mfaSessionUserId(undefined)).toBeNull();
    expect(mfaSessionUserId({ sub: 7 })).toBeNull();
  });
});
