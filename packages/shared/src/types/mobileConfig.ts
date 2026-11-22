/**
 * `GET /api/mobile/config`: what the phone needs before it draws anything. Parse it leniently:
 * a field the app does not know is ignored, a missing one takes the default.
 */
export interface MobileConfig {
  /** Which optional modules the server has switched on. */
  flags: { compliance: boolean; roster: boolean; workforce: boolean; brain: boolean };
  /** Lowest app version allowed to read from the server; "0.0.0" blocks nobody. */
  minVersion: string;
  /** Where "update the app" sends the user; null until the owner has set the listing. */
  storeUrls: { ios: string | null; android: string | null };
  languages_enabled: string[];
}
