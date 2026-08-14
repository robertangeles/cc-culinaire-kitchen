/**
 * @module middleware/requireFlag
 *
 * Express middleware factory that 404s an entire router when a boolean
 * `site_setting` flag is not `"true"`.
 *
 * This is the rollback mechanism the compliance-vault and roster rollout
 * plans both promise ("flag OFF -> routes 404, < 1 minute") but that no
 * code in this repo actually implemented until now — every existing flag
 * (`brain_enabled` and its siblings) is checked inside a service or job
 * function body, which makes the *behaviour* inert but leaves the *route*
 * reachable and authenticatable. That's enough for a background job, not
 * for "this feature does not exist yet."
 *
 * Mounted with `router.use(requireFlag(...))` BEFORE `router.use(authenticate)`,
 * so a flagged-off feature 404s an unauthenticated prober too — the route
 * genuinely looks absent, not merely locked.
 *
 * Fails closed: a settings-read error also 404s. If `site_setting` is
 * unreadable, the guarded route's own DB-backed handlers would fail anyway,
 * so refusing early costs nothing and never turns a DB blip into an
 * accidental flag-off bypass.
 */

import type { Request, Response, NextFunction } from "express";
import { getAllSettings } from "../services/settingsService.js";

export function requireFlag(settingKey: string) {
  return async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const settings = await getAllSettings();
      if (settings[settingKey] !== "true") {
        res.status(404).end();
        return;
      }
      next();
    } catch {
      res.status(404).end();
    }
  };
}
