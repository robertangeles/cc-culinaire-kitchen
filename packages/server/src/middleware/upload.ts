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

/** A profile photo we uploaded: Cloudinary, image, in the avatar folder. Captures cloud name and public_id. */
const PROFILE_PHOTO_URL = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:v\d+\/)?(culinaire\/profiles\/[\w-]+)\.\w+$/;

/**
 * The Cloudinary public_id of an avatar upload, or null for any other URL. Different URLs can
 * name the same file (version segment, extension, cloud name), so callers that ask "is this
 * the same photo?" must compare this, never the URL text.
 */
export function profilePhotoPublicId(url: string): string | null {
  return PROFILE_PHOTO_URL.exec(url)?.[2] ?? null;
}

/**
 * Remove a profile photo from Cloudinary. Returns false, touching nothing, for any URL that is
 * not one of our avatar uploads (a Google avatar, a local `/uploads/` file, a URL on another
 * Cloudinary account, anything a user typed into their profile): only our own avatar folder is
 * ever deleted from. A photo Cloudinary no longer has counts as done.
 *
 * @throws when it is one of ours but Cloudinary is not configured or refuses.
 */
export async function deleteProfilePhoto(url: string): Promise<boolean> {
  const match = PROFILE_PHOTO_URL.exec(url);
  if (!match) return false;

  const { getCredentialValueWithFallback } = await import("../services/credentialService.js");
  const cloudName = await getCredentialValueWithFallback("CLOUDINARY_CLOUD_NAME");
  const apiKey = await getCredentialValueWithFallback("CLOUDINARY_API_KEY");
  const apiSecret = await getCredentialValueWithFallback("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary is not configured");
  // destroy() acts on OUR account whatever cloud the URL names, so a URL naming another cloud
  // must not be allowed to reach a same-named file in ours.
  if (match[1] !== cloudName) return false;

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  await cloudinary.uploader.destroy(match[2], { resource_type: "image" });
  return true;
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
