/**
 * @module errorHandler
 *
 * Express error-handling middleware. Every unhandled error that reaches this
 * layer is logged via pino and mapped to an appropriate HTTP status code:
 *
 * - **ZodError** (validation failure) -> 400 with flattened error details.
 * - **AI provider errors** (missing/invalid API key, 401) -> 502 with a
 *   configuration hint.
 * - **All other errors** -> 500 generic internal server error.
 *
 * If response headers have already been sent (e.g. during a streaming
 * response), the middleware returns immediately without writing another
 * response to avoid an ERR_HTTP_HEADERS_SENT crash.
 */

import type { Request, Response, NextFunction } from "express";
import { pino } from "pino";
import { ZodError } from "zod";

const log = pino({ transport: { target: "pino-pretty" } });

/**
 * Central Express error-handling middleware.
 *
 * Logs every error with pino, then responds with a JSON body of the form
 * `{ error: string, details?: object }` and the appropriate HTTP status:
 *
 * | Condition                        | Status | Response `error` value                                  |
 * |----------------------------------|--------|---------------------------------------------------------|
 * | `ZodError`                       | 400    | `"Validation error"` (includes `details`)               |
 * | API-key / 401 provider message   | 502    | `"AI provider error. Check your API key configuration."` |
 * | Everything else                  | 500    | `"Internal server error"`                               |
 *
 * If `res.headersSent` is `true`, the function returns immediately to
 * avoid writing a duplicate response.
 *
 * @param err   - The error thrown or passed via `next(err)`.
 * @param _req  - Express request (unused).
 * @param res   - Express response used to send the error JSON.
 * @param _next - Express next function (unused; required by the Express
 *                error-handler signature).
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  log.error(err, "Unhandled error");

  if (res.headersSent) return;

  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation error", details: err.flatten() });
    return;
  }

  // AI SDK / provider errors — match specific AI provider patterns only
  if (
    err.message?.includes("API key") ||
    err.message?.includes("api_key") ||
    err.message?.includes("401 Unauthorized")
  ) {
    res.status(502).json({ error: "AI provider error. Check your API key configuration." });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}
