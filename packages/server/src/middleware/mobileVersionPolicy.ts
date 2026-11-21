/**
 * @module middleware/mobileVersionPolicy
 *
 * The phone app's "update to continue" rule (owner decision, eng D12). The app sends
 * `X-Mobile-App-Version` on every call; this middleware is attached ONLY to sign-in and the count
 * download. A build below the admin-set minimum gets 426 there, and count writes (saving a line,
 * submitting) are never gated, so counts waiting on an old phone can still be sent.
 *
 * No header (the web app, scripts) passes, and so does a header that is not a version. A minimum that is
 * unset, malformed or unreadable also passes: a settings problem must never lock every chef out of signing in.
 *
 * The minimum lives in the `mobile_min_app_version` site setting (Settings, Site Settings).
 * `mobileVersionGuard` is the older, separate guard of the feedback endpoint and is unrelated.
 */

import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { compareSemver } from "./mobileVersionGuard.js";
import { getAllSettings } from "../services/settingsService.js";

const log = pino({ name: "mobileVersionPolicy" });
/** The minimum is exactly 1.2.3; the app's own version may carry a build tag (1.2.3-beta.1, 1.2.3+12). */
const MIN_RE = /^\d+\.\d+\.\d+$/;
const APP_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+].*)?$/;

async function minimumFromSettings(): Promise<string | undefined> {
  return (await getAllSettings()).mobile_min_app_version;
}

export function requireSupportedMobileVersion(getMin: () => Promise<string | undefined> = minimumFromSettings) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const raw = req.headers["x-mobile-app-version"];
    const version = Array.isArray(raw) ? raw[0] : raw;
    if (!version) return next();
    // A version we cannot read says nothing about whether the build is too old: let it through, like every other doubt here.
    if (!APP_VERSION_RE.test(version)) return next();

    let min: string | undefined;
    try {
      min = await getMin();
    } catch (err) {
      log.warn(err, "Could not read the minimum app version; letting the request through");
      return next();
    }
    if (!min || !MIN_RE.test(min)) return next();

    if (compareSemver(version, min) < 0) {
      res.status(426).json({ error: "Update the app to continue.", code: "upgrade_required", minVersion: min });
      return;
    }
    next();
  };
}
