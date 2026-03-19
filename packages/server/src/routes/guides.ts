/**
 * @module guides (router)
 *
 * Express router for the User Guide API, mounted at `/api/guides`.
 *
 * Endpoints:
 *  - `GET  /`      — Admin: list all guides
 *  - `GET  /:key`  — Authenticated: read a single guide
 *  - `PUT  /:key`  — Admin: create or update a guide
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleGetAllGuides,
  handleGetGuide,
  handleUpsertGuide,
} from "../controllers/guideController.js";

export const guidesRouter = Router();

guidesRouter.get("/", authenticate, requireRole("Administrator"), handleGetAllGuides);
guidesRouter.get("/:key", authenticate, handleGetGuide);
guidesRouter.put("/:key", authenticate, requireRole("Administrator"), handleUpsertGuide);
