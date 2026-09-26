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

export class InvalidStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStateError";
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
