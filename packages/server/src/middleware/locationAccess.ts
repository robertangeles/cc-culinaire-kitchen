/**
 * @module middleware/locationAccess
 *
 * `router.param("locId", locationParamGuard)`: every route with a `:locId` path segment
 * is refused (403 LOCATION_NOT_ALLOWED) unless the caller may use that location, so a new
 * `/locations/:locId/...` route cannot forget the check.
 */
import type { RequestParamHandler } from "express";
import { assertLocationAccess } from "../services/locationContextService.js";

export const locationParamGuard: RequestParamHandler = async (req, _res, next, locId) => {
  try {
    await assertLocationAccess(req.user!, String(locId));
    next();
  } catch (err) {
    next(err);
  }
};
