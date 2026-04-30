/**
 * Kill any processes occupying the dev server ports (5179, 3009).
 * Runs automatically before `pnpm dev` to prevent port conflicts
 * from orphaned Node processes on Windows.
 *
 * Per CLAUDE.md Local Development Ports — Vite on 5179, Express on 3009
 * to avoid colliding with other local projects.
 *
 * Uses Node.js + child_process so it works on Windows without bash/WSL.
 */

import { execSync } from "child_process";

const PORTS = [5179, 3009];

for (const port of PORTS) {
  try {
    const output = execSync("netstat -ano", { encoding: "utf-8" });
    const lines = output.split("\n").filter(
      (line) => line.includes(`:${port} `) && line.includes("LISTENING")
    );

    const pids = [...new Set(
      lines.map((line) => line.trim().split(/\s+/).pop()).filter((pid) => pid && pid !== "0")
    )];

    for (const pid of pids) {
      console.log(`Killing stale process on port ${port} (PID ${pid})`);
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      } catch {
        // Process may have already exited
      }
    }
  } catch {
    // netstat not available or no matches — continue
  }
}

console.log("Dev ports cleared.");
