import { z } from "zod";

export { NUDGE_ELIGIBLE_AFTER_HOURS } from "../constants/compliance.js";

/**
 * The web's lists (`packages/client/src/lib/complianceDocumentTypes.ts`, `components/compliance/documentFormShared.ts`), copied for the
 * phone: keep the two in step. The server matches a document type by its exact text.
 */
export const DOCUMENT_TYPES = ["RSA", "Food Safety Supervisor", "Working with Children Check", "Police Check", "Food Handler", "Visa / Work Rights", "Other"] as const;
export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export const ENGAGEMENT_TYPES = [
  { value: "employee", label: "Employee" },
  { value: "contractor", label: "Contractor" },
  { value: "agency", label: "Agency staff" },
] as const;
/** `POST /api/compliance/documents/upload` takes one JPEG, PNG or PDF of up to this size. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** One of the person's own documents (`GET /api/compliance/documents/mine`). Only the fields the person's own screens show are read. */
export const MyDocumentSchema = z.object({
  complianceDocumentId: z.string(),
  documentType: z.string().catch("Document"),
  verificationStatus: z.string().catch(""),
  documentNumber: z.string().nullable().catch(null),
  issueDate: z.string().nullable().catch(null),
  expiryDate: z.string().nullable().catch(null),
  issuingJurisdiction: z.string().nullable().catch(null),
  uploadedAt: z.string().catch(""),
  rejectionReason: z.string().nullable().catch(null),
  /** Which file this row holds: how the phone tells that a send whose answer was lost did land. */
  storagePublicId: z.string().nullable().catch(null),
  /** pdf, jpg or png; null on rows older than the column (the server serves those as a PDF). */
  storageFormat: z.string().nullable().catch(null),
});
export type MyDocument = z.infer<typeof MyDocumentSchema>;
export const MyDocumentsSchema = z.array(z.unknown()).transform((rows) => rows.flatMap((r) => { const p = MyDocumentSchema.safeParse(r); return p.success ? [p.data] : []; }));

const read = z.string().optional().catch(undefined);
/** The upload's answer: where the file was put, and what the server could read off a photo. */
export const UploadReplySchema = z.object({
  storagePublicId: z.string(),
  storageFormat: z.string().nullable().catch(null),
  ocr: z.object({ documentNumber: read, issueDate: read, expiryDate: read }).catch({}),
});
export type UploadReply = z.infer<typeof UploadReplySchema>;

/** `GET /documents/:id/view-url`: a link that works for two minutes. Only https is ever opened. */
export const ViewUrlSchema = z.object({ url: z.string().url().refine((u) => u.startsWith("https://")) });
