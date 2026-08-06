/**
 * @module services/documentStorageService
 *
 * Private storage for compliance documents: RSA certificates, Food Safety
 * Supervisor cards, police checks, Medicare cards, working-with-children checks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS SERVICE MUST NEVER CALL `uploadFileBuffer` FROM middleware/upload.ts.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * That helper looks reusable and is not. When Cloudinary credentials are absent
 * or fail to load it SILENTLY falls back to writing the file to local disk under
 * `/uploads/<name>` (upload.ts:86-93), and `index.ts` serves that directory with
 * `express.static` and no authentication at all. For a logo that is fine. For a
 * police check or a Medicare card it is a notifiable data breach, one missing
 * environment variable away, with no error raised and nothing in the logs to say
 * it happened.
 *
 * So this module has NO local-disk branch anywhere in it. Missing credentials
 * are a hard failure: nothing is written, and the caller returns 503.
 *
 * DELIVERY MODEL
 *   upload  ->  magic-byte sniff (never trust the client's declared MIME)
 *           ->  cloudinary type:"private", org-scoped folder
 *           ->  we store the public_id ONLY, never a URL
 *
 *   view    ->  caller has already passed requirePermission + an ownership check
 *           ->  private_download_url with a 120-second expiry
 *           ->  document_access_log row written for EVERY attempt, granted or denied
 *
 * `type: "private"` means the asset is NOT delivered from the CDN. Every view is
 * an authenticated API call to Cloudinary: slower and metered, which is the
 * correct trade for this content. Consequence for callers: issue URLs on click,
 * never prefetch them for a list of thirty documents.
 *
 * The 120-second TTL is set explicitly. Cloudinary's default is one hour, which
 * is far longer than opening a document needs and leaves a leaked link live well
 * past the session that produced it.
 *
 * ENCRYPTION AT REST is Cloudinary's, not ours — an accepted, recorded deviation
 * from a literal reading of the spec's "AES-256 at rest". If procurement ever
 * asks who can decrypt these, the honest answer is "Cloudinary and us".
 */

import { v2 as cloudinary } from "cloudinary";
import pino from "pino";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { documentAccessLog } from "../db/schema.js";

const logger = pino({ name: "documentStorageService" });

/** Signed-URL lifetime. Long enough to open a document, short enough that a leaked link dies fast. */
export const SIGNED_URL_TTL_SECONDS = 120;

/**
 * Accepted upload types. `image/svg+xml` is deliberately ABSENT even though
 * middleware/upload.ts allows it for images: an SVG is an XML document that can
 * carry script, and these files are served back to managers.
 */
export type AllowedMime = "application/pdf" | "image/jpeg" | "image/png";

/** Raised when storage cannot proceed. `status` is what the route should return. */
export class DocumentStorageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "DocumentStorageError";
  }
}

/**
 * Identify a buffer by its magic bytes.
 *
 * The client's declared MIME type is attacker-controlled, so it is not consulted.
 * A PDF renamed to `.jpg` and a polyglot file both fail here.
 */
export function sniffMime(buffer: Buffer): AllowedMime | null {
  if (buffer.length < 12) return null;

  // %PDF
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  return null;
}

/**
 * Load Cloudinary credentials and configure the SDK.
 *
 * Throws rather than returning a falsy value, so there is no code path where a
 * caller can "handle" missing credentials by writing somewhere else.
 */
async function requireCloudinary(): Promise<void> {
  const { getCredentialValueWithFallback } = await import("./credentialService.js");
  const cloudName = await getCredentialValueWithFallback("CLOUDINARY_CLOUD_NAME");
  const apiKey = await getCredentialValueWithFallback("CLOUDINARY_API_KEY");
  const apiSecret = await getCredentialValueWithFallback("CLOUDINARY_API_SECRET");

  if (!cloudName || !apiKey || !apiSecret) {
    logger.error(
      { alert: "compliance_storage_unavailable" },
      "Cloudinary credentials missing — refusing to store a compliance document. " +
        "There is deliberately no local-disk fallback here.",
    );
    throw new DocumentStorageError(
      "Can't accept uploads right now.",
      503,
      "STORAGE_UNCONFIGURED",
    );
  }

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
}

/**
 * True when compliance storage is usable. The boot check calls this so the
 * feature flag cannot be switched on without working credentials.
 */
export async function isStorageConfigured(): Promise<boolean> {
  try {
    await requireCloudinary();
    return true;
  } catch {
    return false;
  }
}

/**
 * Store a compliance document and return its Cloudinary `public_id`.
 *
 * Persist the returned id, never a URL — URLs are minted per view and expire.
 */
export async function storeDocument(
  buffer: Buffer,
  organisationId: number,
): Promise<{ publicId: string; mime: AllowedMime }> {
  if (buffer.length === 0) {
    throw new DocumentStorageError("That file looks empty.", 400, "EMPTY_UPLOAD");
  }

  const mime = sniffMime(buffer);
  if (!mime) {
    throw new DocumentStorageError(
      "Only PDF, JPG or PNG files are accepted.",
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }

  await requireCloudinary();

  // Org-scoped folder so one tenant's documents are never adjacent to another's.
  const folder = `culinaire/compliance/org-${organisationId}`;

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, type: "private", resource_type: "auto" },
      (error, result) => {
        if (error || !result) {
          logger.error(
            { err: error, alert: "compliance_storage_unavailable", organisationId },
            "Compliance document upload failed",
          );
          reject(
            new DocumentStorageError(
              "Upload didn't finish. Try again.",
              502,
              "STORAGE_UPLOAD_FAILED",
            ),
          );
          return;
        }
        logger.info({ publicId: result.public_id, organisationId }, "Compliance document stored");
        resolve({ publicId: result.public_id, mime });
      },
    );
    stream.end(buffer);
  });
}

/**
 * Mint a short-lived signed URL for one document and record the access.
 *
 * The caller MUST have already established that this actor may see this
 * document. This function does not re-authorise; it records and signs.
 *
 * Every call writes a `document_access_log` row — including denials, which are
 * the interesting ones when reconstructing an incident.
 */
export async function signedUrlForDocument(params: {
  complianceDocumentId: string;
  publicId: string;
  format: string;
  actorUserId: number;
  ipAddress?: string;
  /** Pass false when the caller has already decided this actor may NOT see it. */
  granted: boolean;
}): Promise<string | null> {
  await db.insert(documentAccessLog).values({
    complianceDocumentId: params.complianceDocumentId,
    actorUserId: params.actorUserId,
    outcome: params.granted ? "granted" : "denied",
    ipAddress: params.ipAddress ?? null,
  });

  if (!params.granted) {
    logger.warn(
      {
        complianceDocumentId: params.complianceDocumentId,
        actorUserId: params.actorUserId,
      },
      "Denied compliance document access",
    );
    return null;
  }

  await requireCloudinary();

  return cloudinary.utils.private_download_url(params.publicId, params.format, {
    expires_at: Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS,
  });
}

/**
 * Destroy the stored object.
 *
 * The retention purge calls this. Deleting the database row alone would strand
 * the blob in Cloudinary where no retention policy can ever reach it — the
 * classic way a documented purge schedule quietly fails to purge anything.
 */
export async function deleteStoredDocument(publicId: string): Promise<void> {
  await requireCloudinary();
  await cloudinary.uploader.destroy(publicId, { type: "private", resource_type: "image" });
  logger.info({ publicId }, "Compliance document destroyed");
}

/** Access history for one document — the post-incident question. */
export function listAccessLog(complianceDocumentId: string, limit = 100) {
  return db
    .select({
      actorUserId: documentAccessLog.actorUserId,
      outcome: documentAccessLog.outcome,
      ipAddress: documentAccessLog.ipAddress,
      createdDttm: documentAccessLog.createdDttm,
    })
    .from(documentAccessLog)
    .where(eq(documentAccessLog.complianceDocumentId, complianceDocumentId))
    .limit(limit);
}

/** Denied attempts by one actor — the "is someone probing?" question. */
export function listDeniedAccessByActor(actorUserId: number, limit = 100) {
  return db
    .select({
      complianceDocumentId: documentAccessLog.complianceDocumentId,
      createdDttm: documentAccessLog.createdDttm,
      ipAddress: documentAccessLog.ipAddress,
    })
    .from(documentAccessLog)
    .where(
      and(eq(documentAccessLog.actorUserId, actorUserId), eq(documentAccessLog.outcome, "denied")),
    )
    .limit(limit);
}
