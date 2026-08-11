/**
 * @module middleware/auth
 *
 * Express middleware for JWT authentication and role-based access control.
 * Reads access tokens from httpOnly cookies and populates `req.user`.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken, type TokenPayload } from "../services/authService.js";

/** Extends Express Request with the decoded token payload. */
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Extracts the access token from either the `Authorization: Bearer <token>`
 * header (preferred for native mobile clients) or the `access_token` cookie
 * (used by the web client). Returns null if neither is present.
 */
function extractAccessToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const headerToken = authHeader.slice(7).trim();
    if (headerToken) return headerToken;
  }
  return req.cookies?.access_token ?? null;
}

/**
 * Verifies the JWT access token (from Bearer header or cookie) and attaches
 * the decoded payload to `req.user`. Returns 401 if no valid token is present.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractAccessToken(req);

  if (!token) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

/**
 * Optional-auth variant: attaches `req.user` when a valid token is present
 * and silently continues (with `req.user` undefined) when none is — never
 * 401s. For endpoints that accept BOTH signed-in and anonymous traffic, e.g.
 * `POST /api/mobile/feedback` where the login screen submits anonymously
 * before the user has an account.
 *
 * An *invalid* (malformed / expired) token is still 401 — silently treating
 * a forged token as anonymous would be a downgrade-attack vector.
 */
export function authenticateOptional(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = extractAccessToken(req);
  if (!token) {
    next();
    return;
  }

  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

/**
 * Middleware factory that restricts access to users with any of the
 * specified roles.
 *
 * @example
 * ```ts
 * router.get("/admin", authenticate, requireRole("Administrator"), handler);
 * ```
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    const hasRole = req.user.roles.some((r) => roles.includes(r));
    if (!hasRole) {
      res.status(403).json({ error: "Insufficient permissions." });
      return;
    }

    next();
  };
}

/** The minimum an authorization decision needs: what roles and permissions a caller holds. */
export interface PermissionPrincipal {
  roles: string[];
  permissions: string[];
}

/**
 * THE authorization decision. Pure, no Express, no request object.
 *
 * This exists as a standalone function so that non-HTTP callers — the Antoine
 * compliance tools in particular — can ask the SAME question the middleware
 * asks, rather than reimplementing it. A second copy of the Administrator
 * bypass is how a chat surface ends up answering a question the web UI refuses:
 * add a permission in one place, forget the other, and the gap is a data leak
 * rather than a bug.
 *
 * Administrators are superusers with implicit all-access. That prevents a newly
 * seeded permission from silently locking admins out of a feature until someone
 * remembers to grant it to the Administrator role.
 *
 * @returns true if the principal may proceed.
 */
export function hasPermission(principal: PermissionPrincipal, ...perms: string[]): boolean {
  if (principal.roles.includes("Administrator")) return true;
  return principal.permissions.some((p) => perms.includes(p));
}

/**
 * Middleware factory that restricts access to users with any of the
 * specified permissions.
 *
 * A thin Express wrapper over {@link hasPermission} — the decision itself lives
 * there so it has exactly one implementation.
 *
 * @example
 * ```ts
 * router.get("/users", authenticate, requirePermission("admin:users"), handler);
 * ```
 */
export function requirePermission(...perms: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }

    if (!hasPermission(req.user, ...perms)) {
      res.status(403).json({ error: "Insufficient permissions." });
      return;
    }

    next();
  };
}
