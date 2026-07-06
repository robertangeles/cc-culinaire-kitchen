/**
 * @module brain (router)
 *
 * Express router for the "Your Brain" API, mounted at `/api/brain`
 * (docs/specs/brain-memory.md, T8/T9).
 *
 * Endpoints:
 *  - `GET    /memories`     — brain:read   — list own memories
 *  - `DELETE /memories/:id` — brain:manage — delete an own memory
 *  - `GET    /stats`        — Administrator — Brain health snapshot (T9)
 *
 * The permission gates are the security boundary (nav-hiding is UX only);
 * Administrators pass every requirePermission via the superuser bypass.
 */

import { Router } from "express";
import { authenticate, requirePermission, requireRole } from "../middleware/auth.js";
import {
  handleListMemories,
  handleDeleteMemory,
  handleBrainStats,
} from "../controllers/brainController.js";

export const brainRouter = Router();

brainRouter.get("/memories", authenticate, requirePermission("brain:read"), handleListMemories);
brainRouter.delete("/memories/:id", authenticate, requirePermission("brain:manage"), handleDeleteMemory);
brainRouter.get("/stats", authenticate, requireRole("Administrator"), handleBrainStats);
