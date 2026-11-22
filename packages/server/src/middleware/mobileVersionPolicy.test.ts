import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { requireSupportedMobileVersion, mobileUpdateGate } from "./mobileVersionPolicy.js";

const NO_STORES = async () => ({ ios: null, android: null });

function run(
  header: string | undefined,
  getMin: () => Promise<string | undefined>,
  getStoreUrls: () => Promise<{ ios: string | null; android: string | null }> = NO_STORES,
) {
  const req = { headers: header === undefined ? {} : { "x-mobile-app-version": header } } as unknown as Request;
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnThis();
  const res = { status, json } as unknown as Response;
  const next = vi.fn();
  const done = requireSupportedMobileVersion(getMin, { getStoreUrls })(req, res, next);
  return { done, status, json, next, req };
}

describe("mobile version policy (requireSupportedMobileVersion)", () => {
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
    expect(old.json).toHaveBeenCalledWith({ error: "Update the app to continue.", code: "upgrade_required", minVersion: "1.2.0", storeUrls: { ios: null, android: null } });
  });

  it("puts the store links in the 426 body, so a signed-out old build can show where to update", async () => {
    const storeUrls = { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" };
    const r = run("1.1.9", async () => "1.2.0", async () => storeUrls);
    await r.done;
    expect(r.status).toHaveBeenCalledWith(426);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "upgrade_required", minVersion: "1.2.0", storeUrls }));
  });

  it("still answers 426 when the store links cannot be read", async () => {
    const r = run("1.1.9", async () => "1.2.0", async () => { throw new Error("db down"); });
    await r.done;
    expect(r.status).toHaveBeenCalledWith(426);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ minVersion: "1.2.0", storeUrls: { ios: null, android: null } }));
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

  it("lets a version it cannot read through, with or without a minimum, rather than locking a chef out over a typo", async () => {
    for (const header of ["not-a-version", "1.0", "1.0.0.1", "1.2.3, 1.2.3"]) {
      const r = run(header, async () => "1.0.0");
      await r.done;
      expect(r.next, header).toHaveBeenCalled();
      expect(r.status, header).not.toHaveBeenCalled();
    }
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

describe("update gate on every phone route (mobileUpdateGate)", () => {
  function gate(method: string, url: string, version: string | undefined, min = "2.0.0") {
    const req = {
      method,
      originalUrl: url,
      headers: version === undefined ? {} : { "x-mobile-app-version": version },
    } as unknown as Request;
    const json = vi.fn().mockReturnThis();
    const status = vi.fn().mockReturnThis();
    const next = vi.fn();
    const done = mobileUpdateGate(async () => min, NO_STORES)(req, { status, json } as unknown as Response, next);
    return { done, status, json, next };
  }

  it("answers 426 upgrade_required to an old build reading any route", async () => {
    for (const url of ["/api/inventory/stock-takes/active", "/api/auth/me", "/api/mobile/feature-flags?x=1"]) {
      const r = gate("GET", url, "1.0.0");
      await r.done;
      expect(r.status, url).toHaveBeenCalledWith(426);
      expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ code: "upgrade_required", minVersion: "2.0.0" }));
      expect(r.next).not.toHaveBeenCalled();
    }
  });

  it("never blocks a write, so counts and other commands queued on an old phone can still be sent", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const r = gate(method, "/api/inventory/stock-takes/abc/categories/dry/lines", "1.0.0");
      await r.done;
      expect(r.next, method).toHaveBeenCalled();
    }
  });

  it("leaves the config endpoint, the health check and logout open, so a signed-in old build can still call them", async () => {
    for (const [method, url] of [["GET", "/api/mobile/config"], ["GET", "/api/health"], ["POST", "/api/auth/logout"], ["GET", "/api/mobile/config?v=1"]]) {
      const r = gate(method, url, "1.0.0");
      await r.done;
      expect(r.next, url).toHaveBeenCalled();
    }
  });

  it("does not touch the web or a current build", async () => {
    for (const version of [undefined, "2.0.0", "2.1.0"]) {
      const r = gate("GET", "/api/inventory/stock-takes/active", version);
      await r.done;
      expect(r.next).toHaveBeenCalled();
    }
  });
});
