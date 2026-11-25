import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";

/**
 * Which 30-second steps an authenticator code is accepted in (its own and the one after it), and that it is accepted
 * once. Runs the real otplib against a fixed clock (mfaProof.test.ts mocks the library), with only the database mocked.
 * Every test is a new user: the last accepted step is kept per user for the life of the process.
 */
const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, writes: [] as Record<string, unknown>[] }));

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
vi.mock("./emailService.js", () => ({}));
// Sign-in reads the person's details once their code is accepted; stopping there shows that it was.
vi.mock("./piiService.js", () => ({
  decryptUserPii: () => {
    throw new Error("code accepted");
  },
}));
vi.mock("./settingsService.js", () => ({}));

import { generate } from "otplib";
import { completeMfaLogin, createMfaSessionToken, disableMfa, enableMfa, verifyMfaToken } from "./authService.js";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const PASSWORD = "correct horse battery";
const passwordHash = bcrypt.hashSync(PASSWORD, 4);
const STEP = 30;
/** 2025-11-25T17:01:30Z, the first second of a step. */
const STEP_START = Date.UTC(2025, 10, 25, 17, 1, 30) / 1000;

const at = (epoch: number) => vi.setSystemTime(epoch * 1000);
const codeOf = (epoch: number) => generate({ secret: SECRET, epoch });
let userId = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(STEP_START);
  state.writes = [];
  state.row = { userId: ++userId, userPasswordHash: passwordHash, mfaEnabledInd: true, mfaSecret: SECRET };
});
afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ["the first second", STEP_START],
  ["the last second", STEP_START + STEP - 1],
])("verifyMfaToken at %s of a step", (_name, now) => {
  beforeEach(() => void at(now));

  it.each([
    ["the current step", 0, true],
    ["the previous step", -1, true],
    ["two steps ago", -2, false],
    ["the next step", 1, false],
  ])("code of %s", async (_label, steps, accepted) => {
    expect(await verifyMfaToken(userId, await codeOf(now + steps * STEP))).toBe(accepted);
  });
});

describe("verifyMfaToken: garbage", () => {
  it("refuses a well-formed but wrong code", async () => {
    const wrong = (await codeOf(STEP_START)) === "000000" ? "000001" : "000000";
    expect(await verifyMfaToken(userId, wrong)).toBe(false);
  });

  it.each(["", "abcdef", "12345", "1234567", "12 456", "-12345", "123456\n", "１２３４５６", 123456, null, undefined, {}, ["123456"]])(
    "refuses %j as a wrong code: a refusal, not an error",
    async (token) => {
      expect(await verifyMfaToken(userId, token as string)).toBe(false);
      const refused = { code: "INVALID_MFA_CODE", statusCode: 401 };
      await expect(completeMfaLogin(createMfaSessionToken(userId), token as string)).rejects.toMatchObject(refused);
      await expect(enableMfa(userId, token as string)).rejects.toMatchObject(refused);
      expect(state.writes).toEqual([]);
    },
  );

  it("refuses every code for an account with no secret", async () => {
    state.row.mfaSecret = null;
    expect(await verifyMfaToken(userId, await codeOf(STEP_START))).toBe(false);
  });
});

describe("a code made just before a step change and checked just after it", () => {
  const justBefore = () => codeOf(STEP_START - 1);

  it("completes a sign-in", async () => {
    await expect(completeMfaLogin(createMfaSessionToken(userId), await justBefore())).rejects.toThrow("code accepted");
    await expect(completeMfaLogin(createMfaSessionToken(userId), await codeOf(STEP_START - STEP - 1))).rejects.toMatchObject({ code: "INVALID_MFA_CODE" });
  });

  it("turns two-step verification on", async () => {
    state.row.mfaEnabledInd = false;
    await enableMfa(userId, await justBefore());
    expect(state.writes[0]).toMatchObject({ mfaEnabledInd: true });
  });

  it("turns two-step verification off (the CI failure: the password check ran across the step change)", async () => {
    await disableMfa(userId, { password: PASSWORD, mfaCode: await justBefore() }, null);
    expect(state.writes[0]).toMatchObject({ mfaEnabledInd: false, mfaSecret: null });
  });
});

describe("a code is accepted once", () => {
  const verify = (code: string) => verifyMfaToken(userId, code);

  it("refuses a used code for as long as it is in time", async () => {
    const code = await codeOf(STEP_START);
    expect(await verify(code)).toBe(true);
    expect(await verify(code)).toBe(false);
    at(STEP_START + 2 * STEP - 1);
    expect(await verify(code)).toBe(false);
  });

  it("refuses the previous step's code once the current one is used", async () => {
    expect(await verify(await codeOf(STEP_START))).toBe(true);
    expect(await verify(await codeOf(STEP_START - STEP))).toBe(false);
  });

  it("accepts the current code after the previous step's, and the next one after that", async () => {
    expect(await verify(await codeOf(STEP_START - STEP))).toBe(true);
    expect(await verify(await codeOf(STEP_START))).toBe(true);
    at(STEP_START + STEP);
    expect(await verify(await codeOf(STEP_START + STEP))).toBe(true);
  });

  it("a refused code uses nothing up", async () => {
    const code = await codeOf(STEP_START);
    expect(await verify(code === "000000" ? "000001" : "000000")).toBe(false);
    expect(await verify("12345")).toBe(false);
    expect(await verify(await codeOf(STEP_START + STEP))).toBe(false);
    expect(await verify(code)).toBe(true);
  });

  it("accepts one of two requests with the same code at the same moment", async () => {
    const code = await codeOf(STEP_START);
    expect((await Promise.all([verify(code), verify(code), verify(code)])).filter(Boolean)).toHaveLength(1);
  });

  it("is per person: the same step is accepted for someone else", async () => {
    const code = await codeOf(STEP_START);
    expect(await verify(code)).toBe(true);
    expect(await verifyMfaToken(++userId, code)).toBe(true);
  });

  it("holds across sign-in, turning two-step on and turning it off", async () => {
    const used = await codeOf(STEP_START - STEP);
    await enableMfa(userId, used);
    const refused = { code: "INVALID_MFA_CODE" };
    await expect(completeMfaLogin(createMfaSessionToken(userId), used)).rejects.toMatchObject({ ...refused, statusCode: 401 });
    await expect(disableMfa(userId, { password: PASSWORD, mfaCode: used }, null)).rejects.toMatchObject({ ...refused, statusCode: 403 });
    expect(state.writes).toHaveLength(1);
    await disableMfa(userId, { password: PASSWORD, mfaCode: await codeOf(STEP_START) }, null);
    expect(state.writes[1]).toMatchObject({ mfaEnabledInd: false });
  });
});
