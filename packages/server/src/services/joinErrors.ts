/**
 * @module services/joinErrors
 *
 * Why joining an organisation or a location by key was refused. The phone's first-run screen branches on `code`
 * (the English sentence is only a fallback), so each refusal has one.
 */
export type JoinErrorCode =
  | "INVALID_JOIN_KEY"
  | "ALREADY_MEMBER"
  | "STORE_KEY_NOT_FOUND"
  | "LOCATION_INACTIVE"
  | "NOT_ORG_MEMBER"
  | "ALREADY_ASSIGNED";

export class JoinError extends Error {
  constructor(
    message: string,
    public readonly code: JoinErrorCode,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "JoinError";
  }
}
