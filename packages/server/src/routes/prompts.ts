/**
 * @module prompts (router)
 *
 * Express router for the prompt-management API, mounted at `/api/prompts`.
 *
 * Endpoints:
 *  - `GET    /`                              -- List all prompts (metadata).
 *  - `POST   /`                              -- Create a new prompt.
 *  - `GET    /:name`                         -- Retrieve the active prompt content.
 *  - `PUT    /:name`                         -- Update a prompt with new content.
 *  - `POST   /:name/reset`                   -- Reset a prompt to its factory default.
 *  - `GET    /:name/versions`                -- List version history.
 *  - `POST   /:name/versions/:versionId/rollback` -- Rollback to a version.
 *
 * All routes require the Administrator role.
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleListPrompts,
  handleCreatePrompt,
  getPrompt,
  updatePrompt,
  handleResetPrompt,
  listVersions,
  handleRollback,
} from "../controllers/promptsController.js";

export const promptsRouter = Router();

// All prompt routes require Administrator role
promptsRouter.use(authenticate, requireRole("Administrator"));

// Collection-level routes (must be before /:name to avoid conflicts)
promptsRouter.get("/", handleListPrompts);
promptsRouter.post("/", handleCreatePrompt);

// Individual prompt routes
promptsRouter.get("/:name", getPrompt);
promptsRouter.put("/:name", updatePrompt);
promptsRouter.post("/:name/reset", handleResetPrompt);
promptsRouter.get("/:name/versions", listVersions);
promptsRouter.post("/:name/versions/:versionId/rollback", handleRollback);
