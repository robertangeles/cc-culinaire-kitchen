import { describe, it, expect, vi } from "vitest";
import { ApiError } from "../api/client";
import type { KvStore } from "../storage/kv";
import { createPush, readPushData, type Permission, type PushNative } from "./push";

function setup(over: { permission?: Permission; afterAsk?: Permission; token?: () => Promise<string> } = {}) {
  let permission: Permission = over.permission ?? { status: "undetermined", canAskAgain: true };
  const native: PushNative = {
    platform: "android",
    permission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => (permission = over.afterAsk ?? { status: "granted", canAskAgain: true })),
    token: vi.fn(over.token ?? (async () => "ExponentPushToken[abc]")),
    openSettings: vi.fn(),
  };
  const api = { registerDevice: vi.fn(async () => {}), unregisterDevice: vi.fn(async () => {}) };
  const kvMap = new Map<string, string>();
  const kv: KvStore = { get: async (k) => kvMap.get(k) ?? null, set: async (k, v) => void kvMap.set(k, v), delete: async (k) => void kvMap.delete(k) };
  const user = { current: 7 as number | null };
  const push = createPush({ native, api, kv, getUserId: () => user.current });
  return { push, native, api, kvMap, user };
}

describe("push on this phone", () => {
  it("never asks the system at start: an app start only checks", async () => {
    const t = setup();
    await t.push.sync();
    expect(t.native.requestPermission).not.toHaveBeenCalled();
    expect(t.native.token).not.toHaveBeenCalled();
    expect(t.push.getStatus()).toBe("off");
  });

  it("asks when the person turns it on, then registers the token with the server", async () => {
    const t = setup();
    await t.push.enable();
    expect(t.native.requestPermission).toHaveBeenCalledTimes(1);
    expect(t.api.registerDevice).toHaveBeenCalledWith("ExponentPushToken[abc]", "android");
    expect(t.push.getStatus()).toBe("on");
  });

  it("registers again at the next start (the token belongs to the sign-in and can change)", async () => {
    const t = setup();
    await t.push.enable();
    await t.push.sync();
    expect(t.api.registerDevice).toHaveBeenCalledTimes(2);
  });

  it("says blocked when the system prompt is refused, and opens the settings once it can no longer ask", async () => {
    const t = setup({ afterAsk: { status: "denied", canAskAgain: true } });
    await t.push.enable();
    expect(t.push.getStatus()).toBe("blocked");
    expect(t.native.openSettings).not.toHaveBeenCalled();

    const gone = setup({ permission: { status: "denied", canAskAgain: false } });
    await gone.push.enable();
    expect(gone.native.requestPermission).not.toHaveBeenCalled();
    expect(gone.native.openSettings).toHaveBeenCalled();
    expect(gone.api.registerDevice).not.toHaveBeenCalled();
  });

  it("says unavailable when this build cannot get a token (no Expo project or Firebase set-up yet)", async () => {
    const t = setup({ token: async () => Promise.reject(new Error("Default FirebaseApp is not initialized")) });
    await t.push.enable();
    expect(t.push.getStatus()).toBe("unavailable");
    expect(t.api.registerDevice).not.toHaveBeenCalled();
  });

  it("stays on when the server cannot be reached; the next start registers", async () => {
    const t = setup();
    t.api.registerDevice.mockRejectedValueOnce(new ApiError("network"));
    await t.push.enable();
    expect(t.push.getStatus()).toBe("on");
  });

  it("turned off: the server forgets this device and a start does not register it again", async () => {
    const t = setup();
    await t.push.enable();
    await t.push.disable();
    expect(t.api.unregisterDevice).toHaveBeenCalledWith("ExponentPushToken[abc]");
    await t.push.sync();
    expect(t.api.registerDevice).toHaveBeenCalledTimes(1);
    expect(t.push.getStatus()).toBe("off");
  });

  it("unregisters before sign-out, quickly, and a failure does not stop the sign-out", async () => {
    const t = setup();
    await t.push.enable();
    t.api.unregisterDevice.mockRejectedValueOnce(new ApiError("timeout"));
    await t.push.beforeSignOut();
    expect(t.api.unregisterDevice).toHaveBeenCalledWith("ExponentPushToken[abc]", 3000);
    expect(t.kvMap.has("push.token.7")).toBe(false);
  });

  it("keeps each account's choice apart on a shared phone", async () => {
    const t = setup();
    await t.push.enable();
    t.user.current = 8;
    await t.push.sync();
    expect(t.push.getStatus()).toBe("off");
    expect(t.api.registerDevice).toHaveBeenCalledTimes(1);
  });
});

describe("a tapped push", () => {
  it("reads our data and refuses anything else", () => {
    expect(readPushData({ notificationId: "n1", type: "SHIFT_CHANGED", link: "/shifts/abc" })).toEqual({ notificationId: "n1", type: "SHIFT_CHANGED", link: "/shifts/abc" });
    expect(readPushData({ notificationId: "n1", type: "X", link: "https://evil.example.com" })).toBeNull();
    expect(readPushData({ notificationId: "n1", type: "X", link: "//evil.example.com" })).toBeNull();
    expect(readPushData(undefined)).toBeNull();
  });
});
