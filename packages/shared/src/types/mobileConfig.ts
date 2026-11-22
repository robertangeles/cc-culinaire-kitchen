/**
 * `GET /api/mobile/config`: what the phone needs before it draws anything. Parse it leniently:
 * a field the app does not know is ignored, a missing one takes the default.
 */
export type MobileStoreUrls = { ios: string | null; android: string | null };

export interface MobileConfig {
  /** Which optional modules the server has switched on. */
  flags: { compliance: boolean; roster: boolean; workforce: boolean; brain: boolean };
  /** Lowest app version allowed to read from the server; "0.0.0" blocks nobody. */
  minVersion: string;
  /** Where "update the app" sends the user; null until the owner has set the listing. */
  storeUrls: MobileStoreUrls;
  languages_enabled: string[];
}

/**
 * The 426 body a build below the minimum gets from sign-in and the update gate. It repeats `minVersion` and
 * `storeUrls` from the config call, which needs a signed-in user an old build may not have.
 */
export interface UpgradeRequiredBody {
  error: string;
  code: "upgrade_required";
  minVersion: string;
  storeUrls: MobileStoreUrls;
}
