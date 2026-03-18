/**
 * @module middleware/upload
 *
 * Multer configuration for file uploads.
 *
 * Exports:
 * - `upload` — image uploads (favicon, logo, profile photos): 10 MB, image MIME types only
 * - `knowledgeUpload` — knowledge document uploads: 100 MB, PDF/DOCX/TXT/MD
 * - `uploadToCloudinary` — helper to upload a buffer to Cloudinary (if configured)
 *
 * Image uploads use memoryStorage so the buffer can be sent to Cloudinary.
 * If Cloudinary is not configured, falls back to saving to local disk.
 */

import multer from "multer";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { writeFile } from "fs/promises";
import { mkdirSync } from "fs";
import { v2 as cloudinary } from "cloudinary";
import pino from "pino";

const logger = pino({ name: "upload" });
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "../../../../uploads");
try { mkdirSync(UPLOADS_DIR, { recursive: true }); } catch { /* exists */ }

/** Allowed MIME types for image uploads. */
const ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/webp",
];

/**
 * Pre-configured multer instance for image uploads.
 * Uses memoryStorage so buffer can be sent to Cloudinary.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (png, jpg, svg, ico, webp) are allowed"));
    }
  },
});

/**
 * Upload a file buffer to Cloudinary or local disk.
 * Returns the URL (Cloudinary https:// or local /uploads/).
 */
export async function uploadFileBuffer(
  buffer: Buffer,
  originalName: string,
  folder = "culinaire/uploads",
): Promise<string> {
  const { getCredentialValueWithFallback } = await import("../services/credentialService.js");
  const cloudName = await getCredentialValueWithFallback("CLOUDINARY_CLOUD_NAME");
  const apiKey = await getCredentialValueWithFallback("CLOUDINARY_API_KEY");
  const apiSecret = await getCredentialValueWithFallback("CLOUDINARY_API_SECRET");

  if (cloudName && apiKey && apiSecret) {
    // Upload to Cloudinary
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: "auto" },
        (error, result) => {
          if (error) reject(error);
          else {
            logger.info({ url: result!.secure_url, folder }, "File uploaded to Cloudinary");
            resolve(result!.secure_url);
          }
        },
      );
      stream.end(buffer);
    });
  }

  // Fallback: save to local disk
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const filename = `${uniqueSuffix}${extname(originalName)}`;
  const filePath = join(UPLOADS_DIR, filename);
  await writeFile(filePath, buffer);
  const url = `/uploads/${filename}`;
  logger.info({ url }, "File saved locally (Cloudinary not configured)");
  return url;
}

// ---------------------------------------------------------------------------
// Knowledge document uploads (PDF, DOCX, TXT, MD)
// ---------------------------------------------------------------------------

const KNOWLEDGE_MIMES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (KNOWLEDGE_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOCX, TXT, and MD files are allowed"));
    }
  },
});
