import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireSupportedMobileVersion } from "./mobileVersionPolicy.js";

function run(header: string | undefined, getMin: () => Promise<string | undefined>) {
  const req = { headers: header === undefined ? {} : { "x-mobile-app-version": header } } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  const done = requireSupportedMobileVersion(getMin)(req, res, next);
  return { done, status, json, next, req };
}

describe("mobile version policy (sign-in and count download only)", () => {
  it("lets web and any client that sends no version header through", async () => {
    const r = run(undefined, async () => "9.9.9");
    await r.done;
    expect(r.next).toHaveBeenCalled();
    expect(r.status).not.toHaveBeenCalled();
  });

  it("lets a build at or above the minimum through, and a build below it gets 426 with a plain sentence", async () => {
    const ok = run("1.2.0", async () => "1.2.0");
    await ok.done;
    expect(ok.next).toHaveBeenCalled();

    const old = run("1.1.9", async () => "1.2.0");
    await old.done;
    expect(old.next).not.toHaveBeenCalled();
    expect(old.status).toHaveBeenCalledWith(426);
    expect(old.json).toHaveBeenCalledWith({ error: "Update the app to continue.", code: "upgrade_required", minVersion: "1.2.0" });
  });

  it("compares numbers, not text (0.10.0 is newer than 0.9.0)", async () => {
    const r = run("0.10.0", async () => "0.9.0");
    await r.done;
    expect(r.next).toHaveBeenCalled();
  });

  it("blocks nobody when no minimum is set", async () => {
    const r = run("0.0.1", async () => "0.0.0");
    await r.done;
    expect(r.next).toHaveBeenCalled();
  });

  it("accepts a build tag after the version (0.1.0-beta, 0.1.0+12) and compares only the numbers", async () => {
    const pass = run("0.2.0-beta.1", async () => "0.2.0");
    await pass.done;
    expect(pass.next).toHaveBeenCalled();
    const block = run("0.1.9+12", async () => "0.2.0");
    await block.done;
    expect(block.status).toHaveBeenCalledWith(426);
  });

  it("answers 400 for a header that is not a version", async () => {
    const r = run("not-a-version", async () => "1.0.0");
    await r.done;
    expect(r.next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it("fails open: an unreadable or malformed minimum never locks every phone out of signing in", async () => {
    const broken = run("0.1.0", async () => { throw new Error("db down"); });
    await broken.done;
    expect(broken.next).toHaveBeenCalled();

    const junk = run("0.1.0", async () => "banana");
    await junk.done;
    expect(junk.next).toHaveBeenCalled();
  });
});
