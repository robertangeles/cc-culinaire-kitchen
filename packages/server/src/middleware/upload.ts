/**
 * @module middleware/upload
 *
 * Multer configuration for handling image file uploads (favicon, logo).
 * Files are stored in `/uploads` at the monorepo root. Only image MIME
 * types (png, jpg, jpeg, svg, ico, webp) are accepted, with a 2 MB limit.
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
 * - Size limit: 2 MB
 * - File filter: images only (png, jpg, svg, ico, webp)
 */
export const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (png, jpg, svg, ico, webp) are allowed"));
    }
  },
});
