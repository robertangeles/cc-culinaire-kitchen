import { SitePageSchema } from "@culinaire/shared/schemas/legal";
import { ApiError, type ApiClient } from "../api/client";
import { parseMarkdown, type Block } from "./markdown";

export type LegalSlug = "terms" | "privacy";

export type LegalPage = { status: "ok"; title: string; blocks: Block[] } | { status: "unavailable" } | { status: "offline" };

/** The owner publishes these in Settings, Site Pages (the "mobile" surface). Until they do, the server answers 404. */
export function createLegalApi(client: ApiClient) {
  return {
    async load(slug: LegalSlug): Promise<LegalPage> {
      try {
        const page = await client.request("GET", `/api/site-pages/${slug}?surface=mobile`, { auth: false, schema: SitePageSchema });
        const blocks = parseMarkdown(page.bodyMd);
        return blocks.length === 0 ? { status: "unavailable" } : { status: "ok", title: page.title, blocks };
      } catch (err) {
        return err instanceof ApiError && (err.code === "network" || err.code === "timeout") ? { status: "offline" } : { status: "unavailable" };
      }
    },
  };
}

export type LegalApi = ReturnType<typeof createLegalApi>;
