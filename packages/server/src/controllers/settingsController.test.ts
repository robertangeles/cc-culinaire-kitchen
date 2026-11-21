import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../services/settingsService.js", async () => {
  const actual = await vi.importActual<typeof import("../services/settingsService.js")>("../services/settingsService.js");
  return { ...actual, getAllSettings: vi.fn(), upsertSettings: vi.fn(async () => {}) };
});
import { handleUpdateSettings } from "./settingsController.js";
import { upsertSettings } from "../services/settingsService.js";

async function put(body: unknown) {
  const json = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnThis();
  await handleUpdateSettings({ body } as Request, { status, json } as unknown as Response, vi.fn());
  return { status, json };
}

describe("PUT /api/settings: minimum phone app version", () => {
  it.each(["1.2.3", "0.0.0", "10.20.30"])("accepts %s", async (v) => {
    const { status } = await put({ mobile_min_app_version: v });
    expect(status).not.toHaveBeenCalled();
    expect(upsertSettings).toHaveBeenCalledWith({ mobile_min_app_version: v });
  });

  it.each(["", "1.2", "v1.2.3", "banana", "1.2.3-beta", "1.2.3 "])("rejects %j with a plain sentence and saves nothing", async (v) => {
    vi.mocked(upsertSettings).mockClear();
    const { status, json } = await put({ mobile_min_app_version: v, page_title: "x" });
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "The minimum phone app version must look like 1.2.3 (0.0.0 allows every version)." });
    expect(upsertSettings).not.toHaveBeenCalled();
  });

  it("leaves other settings alone when the version is not in the request", async () => {
    vi.mocked(upsertSettings).mockClear();
    await put({ page_title: "Hi" });
    expect(upsertSettings).toHaveBeenCalledWith({ page_title: "Hi" });
  });
});
