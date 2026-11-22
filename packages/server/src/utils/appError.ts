/**
 * An error that carries its HTTP status and a machine-readable code.
 * Thrown from services, answered by `errorHandler` as `{ error, code }`.
 */
import type { ServerErrorCode } from "@culinaire/shared";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ServerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
