/**
 * @module routes/sitePages
 *
 * Two routers:
 *   - publicSitePagesRouter — no auth, mounted at /api/site-pages.
 *   - adminSitePagesRouter — authenticate + Administrator role, mounted
 *     at /api/admin/site-pages.
 *
 * Public lookup must stay unauthenticated so logged-out and guest users
 * can read Terms / Privacy from the landing footer.
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleListPublic,
  handleGetPublic,
  handleListAdmin,
  handleGetAdmin,
  handleUpsertAdmin,
  handleDeleteAdmin,
} from "../controllers/sitePageController.js";

export const publicSitePagesRouter = Router();
publicSitePagesRouter.get("/", handleListPublic);
publicSitePagesRouter.get("/:slug", handleGetPublic);

export const adminSitePagesRouter = Router();
adminSitePagesRouter.use(authenticate, requireRole("Administrator"));
adminSitePagesRouter.get("/", handleListAdmin);
adminSitePagesRouter.get("/:slug", handleGetAdmin);
adminSitePagesRouter.put("/:slug", handleUpsertAdmin);
adminSitePagesRouter.delete("/:slug", handleDeleteAdmin);
