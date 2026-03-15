/**
 * @module routes/knowledge
 *
 * Knowledge document management routes.
 * All endpoints require authentication + Administrator role.
 */

import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.js";
import { knowledgeUpload } from "../middleware/upload.js";
import {
  handleListDocuments,
  handleGetDocument,
  handleUploadDocument,
  handleSubmitUrl,
  handleManualEntry,
  handleReEmbed,
  handleDeleteDocument,
} from "../controllers/knowledgeController.js";

export const knowledgeRouter = Router();

// All knowledge management routes require admin access
knowledgeRouter.use(authenticate, requireRole("Administrator"));

knowledgeRouter.get("/", handleListDocuments);
knowledgeRouter.get("/:id", handleGetDocument);
knowledgeRouter.post("/upload", knowledgeUpload.single("file"), handleUploadDocument);
knowledgeRouter.post("/url", handleSubmitUrl);
knowledgeRouter.post("/manual", handleManualEntry);
knowledgeRouter.post("/:id/re-embed", handleReEmbed);
knowledgeRouter.delete("/:id", handleDeleteDocument);
