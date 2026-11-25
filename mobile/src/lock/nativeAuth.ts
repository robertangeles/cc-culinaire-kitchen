import { authenticateAsync } from "expo-local-authentication";
import type { AuthResult } from "./appLock";

/** The system prompt: Face ID, Touch ID or Android biometrics, with the device passcode as the fallback (and the only way on a device without biometrics). */
export async function nativeAuthenticate(reason: string): Promise<AuthResult> {
  const reply = await authenticateAsync({ promptMessage: reason, disableDeviceFallback: false });
  if (reply.success) return "ok";
  switch (reply.error) {
    case "user_cancel":
    case "app_cancel":
    case "system_cancel":
      return "cancelled";
    case "lockout":
      return "lockout";
    // Android with no screen lock; iOS with no passcode.
    case "not_enrolled":
    case "passcode_not_set":
      return "unprotected";
    default:
      return "failed";
  }
}
