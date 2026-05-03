/**
 * @module components/legal/PublicPage
 *
 * Renders one published `site_page` row to logged-out / guest visitors.
 * Used directly by /terms and /privacy, and indirectly by /pages/:slug
 * for any future admin-created page.
 */

import { Loader2, FileQuestion, AlertTriangle } from "lucide-react";
import { useParams, Link } from "react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePublicPage } from "../../hooks/useSitePages.js";

interface Props {
  /** When provided, fetch this slug. Otherwise read from useParams (for /pages/:slug). */
  slug?: string;
}

function formatLastUpdated(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function PublicPage({ slug: slugProp }: Props) {
  const params = useParams<{ slug: string }>();
  const slug = slugProp ?? params.slug ?? "";
  const state = usePublicPage(slug);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-[#E5E5E5] flex flex-col">
      {/* Slim header */}
      <header className="border-b border-[#1A1A1A] bg-[#0A0A0A]">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="text-[#D4A574] hover:text-[#E5C594] text-sm font-medium transition-colors">
            ← CulinAIre Kitchen
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12">
        {state.status === "loading" && (
          <div className="flex items-center justify-center text-[#666] py-24">
            <Loader2 className="size-5 animate-spin mr-2" /> Loading…
          </div>
        )}

        {state.status === "not-found" && (
          <div className="text-center py-24">
            <FileQuestion className="size-10 mx-auto mb-3 text-[#D4A574]/40" />
            <h1 className="text-2xl font-bold text-white mb-2">Page not found</h1>
            <p className="text-[#999]">This page doesn't exist or hasn't been published yet.</p>
            <Link to="/" className="inline-block mt-6 text-[#D4A574] hover:text-[#E5C594] text-sm transition-colors">
              ← Back home
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div className="px-4 py-3 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 inline-flex items-center gap-2">
            <AlertTriangle className="size-4" /> {state.message}
          </div>
        )}

        {state.status === "ok" && (
          <article>
            <h1 className="text-3xl font-bold text-white mb-2">{state.page.title}</h1>
            <p className="text-sm text-[#666] mb-8">
              Last updated {formatLastUpdated(state.page.updatedDttm)}
            </p>
            {state.page.bodyMd.trim() ? (
              <div className="prose prose-invert prose-base max-w-none prose-headings:text-[#FAFAFA] prose-p:text-[#E5E5E5] prose-strong:text-[#FAFAFA] prose-a:text-[#D4A574] prose-a:no-underline hover:prose-a:underline prose-li:text-[#E5E5E5] prose-code:text-[#D4A574] prose-code:bg-[#161616] prose-code:border prose-code:border-[#2A2A2A] prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-pre:bg-[#161616] prose-pre:border prose-pre:border-[#2A2A2A]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.page.bodyMd}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-[#666] italic">This page has no content yet.</p>
            )}
          </article>
        )}
      </main>
    </div>
  );
}
