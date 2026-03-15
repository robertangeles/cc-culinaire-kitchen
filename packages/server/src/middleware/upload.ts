/**
 * @module middleware/upload
 *
 * Multer configuration for file uploads.
 *
 * Exports two instances:
 * - `upload` — image uploads (favicon, logo): 10 MB, image MIME types only
 * - `knowledgeUpload` — knowledge document uploads: 25 MB, PDF/DOCX/TXT/MD
 */

import multer from "multer";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the uploads directory at the monorepo root. */
const UPLOADS_DIR = join(__dirname, "../../../../uploads");

/** Allowed MIME types for image uploads. */
const ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/webp",
];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
  },
});

/**
 * Pre-configured multer instance for image uploads.
 *
 * - Storage: disk-based in `/uploads`
 * - Size limit: 10 MB
 * - File filter: images only (png, jpg, svg, ico, webp)
 */
export const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (png, jpg, svg, ico, webp) are allowed"));
    }
  },
});

// ---------------------------------------------------------------------------
// Knowledge document uploads (PDF, DOCX, TXT, MD)
// ---------------------------------------------------------------------------

/** Allowed MIME types for knowledge document uploads. */
const KNOWLEDGE_MIMES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const knowledgeStorage = multer.memoryStorage();

/**
 * Pre-configured multer instance for knowledge document uploads.
 *
 * - Storage: memory (buffer passed to extraction pipeline)
 * - Size limit: 25 MB
 * - File filter: PDF, TXT, MD, DOCX only
 */
export const knowledgeUpload = multer({
  storage: knowledgeStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (KNOWLEDGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOCX, TXT, and MD files are allowed"));
    }
  },
});
