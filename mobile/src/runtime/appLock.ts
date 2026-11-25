import { lockAlerts } from "../lock/alerts";
import { createAppLock } from "../lock/appLock";
import { nativeAuthenticate } from "../lock/nativeAuth";

/** The one app lock. */
export const appLock = createAppLock({ authenticate: nativeAuthenticate, now: Date.now, uptime: () => performance.now() });
lockAlerts(appLock.isLocked);
