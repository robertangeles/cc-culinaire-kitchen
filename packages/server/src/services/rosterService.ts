/**
 * @module services/rosterService
 *
 * Barrel re-export — Phase 2a split. All implementation lives in:
 *   rosterShiftService.ts        — roles, shifts, templates, assignments, publish
 *   rosterAvailabilityService.ts — availability, timezone helpers, canAssign gate
 *   rosterErrors.ts              — typed error classes (no service imports)
 *
 * Import from "rosterService.js" for zero caller changes.
 */

export * from "./rosterShiftService.js";
export * from "./rosterAvailabilityService.js";
