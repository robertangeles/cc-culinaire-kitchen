/**
 * @module services/rosterErrors
 *
 * Typed error classes for the Roster domain. Extracted to a standalone
 * module with zero service imports so that workforceDemandService,
 * staffingCoverageService, consentService, and shiftSwapService can all
 * import them without creating circular dependencies after the
 * rosterService split.
 */

import type { ServerErrorCode } from "@culinaire/shared";

export class RosterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    /** Machine-readable reason a client branches on; the 409s that mean different things carry one. */
    public code?: ServerErrorCode,
  ) {
    super(message);
    this.name = "RosterError";
  }
}

export interface AssignmentBlockedInfo {
  documentType: string;
  reason: string;
  expiryDate: string | null;
}

export class AssignmentBlockedError extends RosterError {
  constructor(
    message: string,
    public info: AssignmentBlockedInfo,
  ) {
    super(message, 409, "ASSIGNMENT_BLOCKED_COMPLIANCE");
    this.name = "AssignmentBlockedError";
  }
}

export interface RoleVenueConflict {
  storeLocationId: string;
  locationName: string;
}

export class RoleVenueConflictError extends RosterError {
  constructor(
    message: string,
    public conflicts: RoleVenueConflict[],
  ) {
    super(message, 409);
    this.name = "RoleVenueConflictError";
  }
}
