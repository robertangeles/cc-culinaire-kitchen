import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { adb } from "../../device/adb";

const script = resolve(__dirname, "../../device/lease.sh");
const hasFlock = spawnSync("sh", ["-c", "command -v flock"]).status === 0;
const lease = (file: string, wait: string, ...cmd: string[]) =>
  spawnSync("bash", [script, ...cmd], { encoding: "utf8", env: { ...process.env, DEVICE_LEASE_FILE: file, DEVICE_LEASE_WAIT_S: wait } });
const tmpLock = () => join(mkdtempSync(join(tmpdir(), "lease-")), "lease");

describe.skipIf(!hasFlock)("device lease (needs util-linux flock; skipped when it is not on PATH)", () => {
  it("runs the command with the lease env var set and keeps its exit code", () => {
    const file = tmpLock();
    const ok = lease(file, "5", "sh", "-c", 'echo "lease=$CULINAIRE_DEVICE_LEASE"');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("lease=1");
    expect(lease(file, "5", "sh", "-c", "exit 7").status).toBe(7);
  });

  it("makes a second caller wait, shows who holds the lease and exits 75 on timeout; frees it when the holder ends", async () => {
    const file = tmpLock();
    const holder = spawn("bash", [script, "sleep", "30"], { env: { ...process.env, DEVICE_LEASE_FILE: file }, stdio: "ignore" });
    try {
      await new Promise((r) => setTimeout(r, 500)); // let it take the lock
      const second = lease(file, "1", "true");
      expect(second.status).toBe(75);
      expect(second.stderr).toMatch(/held by: worktree=.* pid=\d+ cmd=sleep 30 since=\d{4}-/);
    } finally {
      holder.kill("SIGTERM");
      await new Promise((r) => holder.once("exit", r));
    }
    // SIGTERM released the lease and removed the holder file.
    const third = lease(file, "1", "true");
    expect(third.status).toBe(0);
    expect(third.stderr).toBe("");
  });
});

describe("adb guard", () => {
  it("refuses to drive a device without the lease", () => {
    const saved = process.env.CULINAIRE_DEVICE_LEASE;
    delete process.env.CULINAIRE_DEVICE_LEASE;
    try {
      expect(() => adb(["devices"])).toThrow(/run check:device/);
    } finally {
      if (saved !== undefined) process.env.CULINAIRE_DEVICE_LEASE = saved;
    }
  });
});
