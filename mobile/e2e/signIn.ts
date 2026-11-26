import { generate } from "otplib";
import type { TestProject } from "vitest/node";
import { createApiClient, type Tokens } from "../src/api/client";
import { createAuthApi } from "../src/api/auth";
import { createSession } from "../src/auth/session";

declare module "vitest" {
  interface ProvidedContext {
    phoneTokens: Tokens | null;
  }
}

/**
 * Signs in the E2E user once for the whole run, with the phone's own session the way a chef does (password, then the code), and hands
 * the tokens to every file: the server accepts an authenticator code once, so a sign-in per file would need a new code every few seconds.
 * `E2E_CODE_STEPS_AGO=1` uses the code of the step before: CI runs this suite twice back to back, so the first run takes the earlier
 * code and the second one's is always unused.
 */
export default async function signIn(project: TestProject) {
  const { E2E_USER_EMAIL: email, E2E_USER_PASSWORD: password, E2E_USER_TOTP_SECRET: secret, CI } = process.env;
  project.provide("phoneTokens", null);
  if (!CI && (!email || !password || !secret)) return; // the files that need the user skip themselves
  if (!email || !password || !secret) throw new Error("Set E2E_USER_EMAIL, E2E_USER_PASSWORD and E2E_USER_TOTP_SECRET.");

  let tokens: Tokens | null = null;
  const tokenStore = { load: async () => tokens, save: async (t: Tokens) => void (tokens = t), clear: async () => void (tokens = null) };
  const client = createApiClient({ baseUrl: process.env.E2E_API_URL ?? "http://localhost:3009", tokenStore, appVersion: "0.1.0-e2e", timeoutMs: 20_000 });
  const session = createSession({ api: createAuthApi(client, tokenStore), hasTokens: async () => tokens !== null, snapshots: { load: async () => null, save: async () => {} } });
  await session.signIn(email, password);
  if (session.getSnapshot().state.phase !== "mfa") throw new Error(`expected to be asked for the code: ${JSON.stringify(session.getSnapshot().state)}`);
  const epoch = Math.floor(Date.now() / 1000) - 30 * Number(process.env.E2E_CODE_STEPS_AGO ?? 0);
  await session.submitCode(await generate({ secret, epoch }));
  const { state } = session.getSnapshot();
  if (state.phase !== "ready") {
    throw new Error(`E2E sign-in failed. A run started in the same 30 seconds as another one has no unused code: start it again.\n${JSON.stringify({ ...state, mfaSessionToken: undefined })}`);
  }
  project.provide("phoneTokens", tokens);
}
