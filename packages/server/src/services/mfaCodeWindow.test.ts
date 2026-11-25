import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import bcrypt from "bcrypt";

/**
 * Which 30-second steps an authenticator code is accepted in: its own and the one after it. Runs the real
 * otplib against a fixed clock (mfaProof.test.ts mocks the library), with only the database mocked.
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at(STEP_START);
  state.writes = [];
  state.row = { userId: 1, userPasswordHash: passwordHash, mfaEnabledInd: true, mfaSecret: SECRET };
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
    expect(await verifyMfaToken(1, await codeOf(now + steps * STEP))).toBe(accepted);
  });
});

describe("verifyMfaToken: garbage", () => {
  it.each(["", "abcdef", "12345", "1234567", "12 456", "-12345", "１２３４５６"])("refuses %j", async (token) => {
    expect(await verifyMfaToken(1, token)).toBe(false);
  });

  it("refuses a value that is not a string", async () => {
    for (const token of [123456, null, {}, ["123456"]]) expect(await verifyMfaToken(1, token as unknown as string)).toBe(false);
  });

  it("refuses every code for an account with no secret", async () => {
    state.row.mfaSecret = null;
    expect(await verifyMfaToken(1, await codeOf(STEP_START))).toBe(false);
  });
});

describe("a code made just before a step change and checked just after it", () => {
  const justBefore = () => codeOf(STEP_START - 1);

  it("completes a sign-in", async () => {
    await expect(completeMfaLogin(createMfaSessionToken(1), await justBefore())).rejects.toThrow("code accepted");
    await expect(completeMfaLogin(createMfaSessionToken(1), await codeOf(STEP_START - STEP - 1))).rejects.toMatchObject({ code: "INVALID_MFA_CODE" });
  });

  it("turns two-step verification on", async () => {
    state.row.mfaEnabledInd = false;
    await enableMfa(1, await justBefore());
    expect(state.writes[0]).toMatchObject({ mfaEnabledInd: true });
  });

  it("turns two-step verification off (the CI failure: the password check ran across the step change)", async () => {
    await disableMfa(1, { password: PASSWORD, mfaCode: await justBefore() }, null);
    expect(state.writes[0]).toMatchObject({ mfaEnabledInd: false, mfaSecret: null });
  });
});
