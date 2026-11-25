import { describe, it, expect, vi } from "vitest";

const { authenticateAsync } = vi.hoisted(() => ({ authenticateAsync: vi.fn() }));
vi.mock("expo-local-authentication", () => ({ authenticateAsync }));

import { nativeAuthenticate } from "./nativeAuth";

describe("the system prompt", () => {
  it("offers the device passcode as the fallback and shows the reason", async () => {
    authenticateAsync.mockResolvedValue({ success: true });
    expect(await nativeAuthenticate("Approve PO-100")).toBe("ok");
    expect(authenticateAsync).toHaveBeenCalledWith({ promptMessage: "Approve PO-100", disableDeviceFallback: false });
  });

  it.each([
    ["user_cancel", "cancelled"],
    ["app_cancel", "cancelled"],
    ["system_cancel", "cancelled"],
    ["lockout", "lockout"],
    // Android with no screen lock at all; iOS without a passcode.
    ["not_enrolled", "unprotected"],
    ["passcode_not_set", "unprotected"],
    ["authentication_failed", "failed"],
    ["timeout", "failed"],
    ["unknown: -1000, something new", "failed"],
  ])("%s reads as %s", async (error, result) => {
    authenticateAsync.mockResolvedValue({ success: false, error });
    expect(await nativeAuthenticate("Unlock")).toBe(result);
  });
});
