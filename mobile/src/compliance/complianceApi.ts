import { MyDocumentsSchema, UploadReplySchema, ViewUrlSchema, type MyDocument, type UploadReply } from "@culinaire/shared/schemas/compliance";
import type { ApiClient } from "../api/client";
import { photoForm, type Photo } from "../api/photo";
import { readSignedImage } from "../api/signedFile";

/** The fields a certificate carries, as the web's form sends them. */
export interface DocumentFields {
  documentNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingJurisdiction: string | null;
}

export interface NewDocument extends DocumentFields {
  documentType: string;
  engagementType: string;
  storagePublicId: string;
  storageFormat: string | null;
}

/** The staff side of compliance: the person's own documents. Online only: a certificate's photo is never kept on the phone. */
export function createComplianceApi(client: ApiClient) {
  const path = (id: string) => `/api/compliance/documents/${encodeURIComponent(id)}`;
  return {
    mine(): Promise<MyDocument[]> {
      return client.request("GET", "/api/compliance/documents/mine", { schema: MyDocumentsSchema });
    },
    /** Stores the photo and reads what it can off it. Nothing is on the person's record until `create`. */
    upload(photo: Photo): Promise<UploadReply> {
      return client.request("POST", "/api/compliance/documents/upload", { body: photoForm(photo, "document"), schema: UploadReplySchema });
    },
    async create(doc: NewDocument): Promise<void> {
      await client.request("POST", "/api/compliance/documents", { body: doc });
    },
    /** Only the four fields: the server refuses any other change by the person themselves. A rejected document goes back to the manager. */
    async update(id: string, fields: DocumentFields): Promise<void> {
      await client.request("PUT", path(id), { body: fields });
    },
    async remove(id: string): Promise<void> {
      await client.request("DELETE", path(id));
    },
    async nudge(id: string): Promise<void> {
      await client.request("POST", `${path(id)}/nudge`);
    },
    /** A link to the stored file that works for two minutes. Each call is logged on the server, so it is made only when the person asks. */
    async viewUrl(id: string): Promise<string> {
      return (await client.request("GET", `${path(id)}/view-url`, { schema: ViewUrlSchema })).url;
    },
    readImage: (url: string) => readSignedImage(url),
  };
}

export type ComplianceApi = ReturnType<typeof createComplianceApi>;
