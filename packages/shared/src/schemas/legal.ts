import { z } from "zod";

/** `GET /api/site-pages/:slug?surface=mobile`: a published page (terms, privacy). A draft is a 404, never an empty body. */
export const SitePageSchema = z.object({ title: z.string(), bodyMd: z.string().catch("") });
export type SitePage = z.infer<typeof SitePageSchema>;
