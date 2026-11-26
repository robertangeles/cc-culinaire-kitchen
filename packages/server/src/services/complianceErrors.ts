import type { ServerErrorCode } from "@culinaire/shared";

const CODE_FOR_STATUS: Record<number, ServerErrorCode> = { 400: "VALIDATION", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "INVALID_STATE" };

/** A refused compliance request. `{ error, code }` on the wire; the code defaults from the status. */
export class ComplianceError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: ServerErrorCode = CODE_FOR_STATUS[statusCode] ?? "VALIDATION",
  ) {
    super(message);
    this.name = "ComplianceError";
  }
}
