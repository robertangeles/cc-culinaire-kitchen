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
 * Verifies the JWT access token from cookies and attaches the decoded
 * payload to `req.user`. Returns 401 if no valid token is present.
 */
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.access_token;

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

/**
 * Middleware factory that restricts access to users with any of the
 * specified permissions.
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

    const hasPerm = req.user.permissions.some((p) => perms.includes(p));
    if (!hasPerm) {
      res.status(403).json({ error: "Insufficient permissions." });
      return;
    }

    next();
  };
}
