/**
 * Kill any processes occupying the dev server ports (5179, 3009).
 * Runs automatically before `pnpm dev` via the "predev" hook.
 *
 * Cross-platform: Linux, macOS, and Windows.
 * Per CLAUDE.md — Vite on 5179, Express on 3009.
 */

import { execFileSync } from "child_process";
import { platform } from "os";

const PORTS = [5179, 3009];
const isWin = platform() === "win32";

for (const port of PORTS) {
  try {
    if (isWin) {
      const output = execFileSync("cmd", ["/c", `netstat -ano | findstr :${port} | findstr LISTENING`], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const pids = [...new Set(
        output.split("\n")
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && pid !== "0"),
      )];
      for (const pid of pids) {
        console.log(`Killing port ${port} (PID ${pid})`);
        try { execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore" }); } catch {}
      }
    } else {
      const output = execFileSync("lsof", ["-ti", `:${port}`], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const pids = output.trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        console.log(`Killing port ${port} (PID ${pid})`);
        try { execFileSync("kill", ["-9", pid], { stdio: "ignore" }); } catch {}
      }
    }
  } catch {
    // No process on this port
  }
}

console.log("Dev ports cleared.");
