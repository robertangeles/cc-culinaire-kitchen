/**
 * @module controllers/knowledgeController
 *
 * Express request handlers for knowledge document management.
 * All endpoints require Administrator role. Source metadata is
 * visible to admins only — never exposed to the AI or end users.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import pino from "pino";
import {
  ingestFile,
  ingestUrl,
  ingestManual,
  reEmbedDocument,
  deleteDocument,
  listDocuments,
  getDocument,
} from "../services/knowledgeManagementService.js";

const logger = pino({ name: "knowledgeController" });

const CATEGORIES = ["techniques", "pastry", "spirits", "ingredients", "general"] as const;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const UploadSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  category: z.string().min(1, "Category is required").max(100),
  tags: z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").map((t: string) => t.trim()).filter(Boolean) : v),
    z.array(z.string()).default([]),
  ),
});

const UrlSchema = z.object({
  url: z.string().url("Invalid URL format"),
  title: z.string().min(1, "Title is required").max(200),
  category: z.string().min(1, "Category is required").max(100),
  tags: z.array(z.string()).default([]),
  crawl: z.boolean().default(false),
});

const ManualSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  category: z.string().min(1, "Category is required").max(100),
  tags: z.array(z.string()).default([]),
  body: z.string().min(10, "Content must be at least 10 characters"),
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** GET /api/knowledge — List all documents (paginated). */
export async function handleListDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const result = await listDocuments(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /api/knowledge/:id — Get single document detail. */
export async function handleGetDocument(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid document ID." });
      return;
    }

    const doc = await getDocument(id);
    if (!doc) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
}

/** POST /api/knowledge/upload — Upload a PDF/DOCX/TXT/MD file. */
export async function handleUploadDocument(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded." });
      return;
    }

    const parsed = UploadSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    const documentId = await ingestFile({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalFilename: req.file.originalname,
      title: parsed.data.title,
      category: parsed.data.category,
      tags: parsed.data.tags,
    });

    logger.info({ documentId, filename: req.file.originalname }, "Document upload started");
    res.status(202).json({ documentId, status: "processing" });
  } catch (err) {
    next(err);
  }
}

/** POST /api/knowledge/url — Submit a URL for scraping. */
export async function handleSubmitUrl(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = UrlSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    const documentId = await ingestUrl(parsed.data);

    logger.info({ documentId, url: parsed.data.url }, "URL ingestion started");
    res.status(202).json({ documentId, status: "processing" });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("URL not allowed")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
}

/** POST /api/knowledge/manual — Submit manually entered text. */
export async function handleManualEntry(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const parsed = ManualSchema.safeParse(req.body);
    if (!parsed.success) {
      const messages = parsed.error.errors.map((e) => e.message).join(". ");
      res.status(400).json({ error: messages });
      return;
    }

    const documentId = await ingestManual(parsed.data);

    logger.info({ documentId }, "Manual entry started");
    res.status(202).json({ documentId, status: "processing" });
  } catch (err) {
    next(err);
  }
}

/** POST /api/knowledge/:id/re-embed — Re-process an existing document. */
export async function handleReEmbed(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid document ID." });
      return;
    }

    await reEmbedDocument(id);
    res.json({ documentId: id, status: "processing" });
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "DOCUMENT_NOT_FOUND") {
        res.status(404).json({ error: "Document not found." });
        return;
      }
      if (err.message === "ALREADY_PROCESSING") {
        res.status(409).json({ error: "Document is already being processed." });
        return;
      }
    }
    next(err);
  }
}

/** DELETE /api/knowledge/:id — Delete a document and its chunks. */
export async function handleDeleteDocument(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid document ID." });
      return;
    }

    const deleted = await deleteDocument(id);
    if (!deleted) {
      res.status(404).json({ error: "Document not found." });
      return;
    }

    logger.info({ documentId: id }, "Document deleted");
    res.json({ message: "Document deleted successfully." });
  } catch (err) {
    next(err);
  }
}
