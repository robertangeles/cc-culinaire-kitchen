/**
 * @module services/stockTakeErrors
 *
 * Typed error classes for the StockTake domain. Extracted to a standalone
 * module with zero service imports so that both stockTakeSessionService and
 * stockTakeCountService can import them without circular dependencies.
 */

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * An area cannot be submitted yet: shared items still have no count on its sheet (D8).
 * A ConflictError (409) that also carries the gaps, so the phone lists them without parsing text.
 * `areaNames` are the other areas in the session that hold the same item.
 */
export class SheetIncompleteError extends ConflictError {
  constructor(
    message: string,
    public readonly missing: Array<{ ingredientId: string; ingredientName: string; areaNames: string[] }>,
  ) {
    super(message);
    this.name = "SheetIncompleteError";
  }
}

export class InvalidStateError extends Error {
  /** A code the phone branches on; the controller falls back to INVALID_STATE. */
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "InvalidStateError";
  }
}

/** The caller may not write to this category (not the claimant, or a stale claim). Maps to 403. */
export class ForbiddenError extends Error {
  /** A code the phone branches on; the controller falls back to FORBIDDEN. */
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
