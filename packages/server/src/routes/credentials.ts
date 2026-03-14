/**
 * @module routes/credentials
 *
 * Express router for the encrypted credentials API.
 * All routes require Admin authentication.
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import {
  handleListCredentials,
  handleUpsertCredential,
  handleRevealCredential,
  handleDeleteCredential,
} from "../controllers/credentialController.js";

export const credentialsRouter = Router();

credentialsRouter.get("/", authenticate, requireRole("Administrator"), handleListCredentials);
credentialsRouter.put("/", authenticate, requireRole("Administrator"), handleUpsertCredential);
credentialsRouter.get("/:key/reveal", authenticate, requireRole("Administrator"), handleRevealCredential);
credentialsRouter.delete("/:key", authenticate, requireRole("Administrator"), handleDeleteCredential);
