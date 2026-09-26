/**
 * @module services/rosterErrors
 *
 * Typed error classes for the Roster domain. Extracted to a standalone
 * module with zero service imports so that workforceDemandService,
 * staffingCoverageService, consentService, and shiftSwapService can all
 * import them without creating circular dependencies after the
 * rosterService split.
 */

export class RosterError extends Error {
  constructor(
    message: string,
    public statusCode: number,
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
    super(message, 409);
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
