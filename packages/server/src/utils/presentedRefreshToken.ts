import type { Request } from "express";

/**
 * The refresh token this request presents: the cookie (web), or `refreshToken` in the body for a
 * bearer client (mobile) that holds no cookie. Only used to look up when the session signed in;
 * the token must still belong to the caller, so a body value cannot name someone else's session.
 */
export function presentedRefreshToken(req: Request): string | undefined {
  const fromBody = req.body?.refreshToken;
  return req.cookies?.refresh_token ?? (typeof fromBody === "string" ? fromBody : undefined);
}
