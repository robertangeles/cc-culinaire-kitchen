import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Its own process: vitest handles these events in this one. */
function run(body: string) {
  const code = `(async () => {
    const { handleProcessErrors } = await import(${JSON.stringify(pathToFileURL(resolve(here, "processErrors.ts")).href)});
    const { pino } = await import("pino");
    const log = pino();
    handleProcessErrors(log, (reason, exitCode) => { log.info("shutdown " + reason); process.exit(exitCode); });
    ${body}
  })();`;
  const child = spawnSync(process.execPath, ["--import", "tsx", "-e", code], { cwd: resolve(here, "../.."), encoding: "utf8" });
  return { status: child.status, lines: child.stdout.trim().split("\n").map((l) => JSON.parse(l)) };
}

describe("handleProcessErrors", () => {
  it("logs an unhandled rejection with its stack and carries on", () => {
    const { status, lines } = run(`Promise.reject(new Error("stray")); setTimeout(() => log.info("still here"), 50);`);
    expect(status).toBe(0);
    expect(lines.map((l) => l.msg)).toEqual(["Unhandled promise rejection", "still here"]);
    expect(lines[0].err.stack).toContain("stray");
  });

  it("logs an uncaught exception and shuts down with an error code", () => {
    const { status, lines } = run(`setTimeout(() => { throw new Error("stray"); }, 0); setTimeout(() => log.info("still here"), 200);`);
    expect(status).toBe(1);
    expect(lines.map((l) => l.msg)).toEqual(["Uncaught exception", "shutdown uncaughtException"]);
    expect(lines[0].err.stack).toContain("stray");
  });
});
