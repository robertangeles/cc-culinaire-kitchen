/**
 * @module brain (router)
 *
 * Express router for the "Your Brain" API, mounted at `/api/brain`
 * (docs/specs/brain-memory.md, T8/T9).
 *
 * Endpoints:
 *  - `GET    /memories`         — brain:read   — list visible memories
 *  - `DELETE /memories/:id`     — brain:manage — delete a memory
 *  - `PATCH  /memories/:id/pin`   — brain:manage — pin/unpin (T14b)
 *  - `PATCH  /memories/:id`       — brain:manage — correct text → re-embed (T14b)
 *  - `PATCH  /memories/:id/scope` — brain:manage — share/un-share (T14b)
 *  - `GET    /stats`            — Administrator — Brain health snapshot (T9)
 *
 * The permission gates are the security boundary (nav-hiding is UX only);
 * Administrators pass every requirePermission via the superuser bypass.
 */

import { Router } from "express";
import { authenticate, requirePermission, requireRole } from "../middleware/auth.js";
import {
  handleListMemories,
  handleDeleteMemory,
  handlePinMemory,
  handleCorrectMemory,
  handleToggleScope,
  handleBrainStats,
  handleBrainAnalytics,
  handleReembedFailed,
  handleGetNudgeOptIn,
  handleSetNudgeOptIn,
} from "../controllers/brainController.js";

export const brainRouter = Router();

brainRouter.get("/memories", authenticate, requirePermission("brain:read"), handleListMemories);
brainRouter.delete("/memories/:id", authenticate, requirePermission("brain:manage"), handleDeleteMemory);
brainRouter.patch("/memories/:id/pin", authenticate, requirePermission("brain:manage"), handlePinMemory);
brainRouter.patch("/memories/:id/scope", authenticate, requirePermission("brain:manage"), handleToggleScope);
brainRouter.patch("/memories/:id", authenticate, requirePermission("brain:manage"), handleCorrectMemory);
brainRouter.get("/stats", authenticate, requireRole("Administrator"), handleBrainStats);
brainRouter.get("/analytics", authenticate, requireRole("Administrator"), handleBrainAnalytics);
brainRouter.post("/reembed-failed", authenticate, requireRole("Administrator"), handleReembedFailed);
brainRouter.get("/nudges/opt-in", authenticate, requirePermission("brain:read"), handleGetNudgeOptIn);
brainRouter.put("/nudges/opt-in", authenticate, requirePermission("brain:read"), handleSetNudgeOptIn);
