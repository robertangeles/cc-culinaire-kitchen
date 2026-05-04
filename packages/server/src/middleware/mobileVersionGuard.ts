/**
 * @module middleware/mobileVersionGuard
 *
 * Express middleware factory that enforces a minimum mobile app version on
 * a per-route basis via the `X-Mobile-App-Version` header. Returns:
 *   - 400 `{ error: "missing_app_version" }` when the header is absent or
 *     malformed
 *   - 426 `{ error: "upgrade_required", minVersion: string }` when the
 *     client is below {@link MIN_MOBILE_APP_VERSION}
 *
 * Per `needs-frontend.md` 2026-05-04 (eng-review finding 1.3) v1.3 gates
 * this enforcement on the feedback endpoint only. Other mobile routes can
 * still parse the header (it's set globally by the mobile `apiClient.ts`)
 * but should not 426 — older builds must keep working until they fail-soft
 * upgrade themselves.
 *
 * The mobile app version on the header is the source of truth for the
 * `app_version` column on `ckm_feedback` rows. Controllers that persist
 * the version pull it from `req.mobileAppVersion`, which is set here.
 */

import type { Request, Response, NextFunction } from "express";
import { MIN_MOBILE_APP_VERSION } from "../utils/env.js";

declare global {
  namespace Express {
    interface Request {
      /** Parsed semver from `X-Mobile-App-Version` (set by the guard). */
      mobileAppVersion?: string;
    }
  }
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * Compare two semver strings. Returns negative if `a < b`, 0 if equal,
 * positive if `a > b`. Pre-release / build metadata are ignored — only
 * `MAJOR.MINOR.PATCH` is compared, which is sufficient for the upgrade
 * gate (mobile increments the patch on every release).
 */
export function compareSemver(a: string, b: string): number {
  const am = SEMVER_RE.exec(a);
  const bm = SEMVER_RE.exec(b);
  if (!am || !bm) {
    throw new Error(`Invalid semver: ${a} vs ${b}`);
  }
  for (let i = 1; i <= 3; i++) {
    const diff = parseInt(am[i]!, 10) - parseInt(bm[i]!, 10);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Middleware factory. Pass `{ enforceMin: true }` on routes that should
 * 426 below {@link MIN_MOBILE_APP_VERSION}. Always 400s on a malformed /
 * missing header so the client surfaces a clear error in dev.
 */
export function mobileVersionGuard(opts: { enforceMin?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const raw = req.headers["x-mobile-app-version"];
    const version = Array.isArray(raw) ? raw[0] : raw;
    if (!version || !SEMVER_RE.test(version)) {
      res.status(400).json({ error: "missing_app_version" });
      return;
    }

    req.mobileAppVersion = version;

    if (opts.enforceMin) {
      try {
        if (compareSemver(version, MIN_MOBILE_APP_VERSION) < 0) {
          res
            .status(426)
            .json({ error: "upgrade_required", minVersion: MIN_MOBILE_APP_VERSION });
          return;
        }
      } catch {
        // Defensive: SEMVER_RE already passed so compareSemver shouldn't
        // throw, but a malformed MIN_MOBILE_APP_VERSION env would. Treat
        // as a server config error rather than letting the request through.
        res.status(500).json({ error: "version_config_error" });
        return;
      }
    }
    next();
  };
}
