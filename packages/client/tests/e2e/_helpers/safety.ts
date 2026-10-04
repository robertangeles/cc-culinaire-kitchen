/** A function, not a constant: playwright.config.ts loads .env.test after its imports are evaluated. */
export function e2eBaseUrl(): string {
  return process.env.E2E_BASE_URL ?? "http://localhost:5179";
}

/** Hosts the E2E suite may write to. The suite creates and deletes real rows, so it must never aim at a deployed environment. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalTarget(baseUrl: string): void {
  let host: string;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    throw new Error(`E2E_BASE_URL is not a valid URL: "${baseUrl}"`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run E2E against "${host}". The suite writes test data, so E2E_BASE_URL ` +
        `must point at localhost or 127.0.0.1.`,
    );
  }
}

/** Run-scoped prefix for every row the suite creates, so concurrent runs never touch each other's data. */
export function e2ePrefix(runId: string): string {
  return `e2e-${runId}-`;
}

export function newRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/** The runId is minted once in playwright.config.ts and inherited by every worker through the environment. */
export function currentPrefix(): string {
  const runId = process.env.E2E_RUN_ID;
  if (!runId) throw new Error("E2E_RUN_ID is not set; it is created in playwright.config.ts");
  return e2ePrefix(runId);
}
