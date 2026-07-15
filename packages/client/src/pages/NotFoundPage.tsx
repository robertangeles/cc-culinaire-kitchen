/**
 * @module pages/NotFoundPage
 *
 * Catch-all for URLs that match no route.
 *
 * Without this, an unknown path rendered the app shell around an EMPTY main —
 * a white void with no explanation and no way back. A typo, a stale bookmark,
 * or /chat instead of /chat/new all landed there and read as "the app is
 * broken" rather than "that page doesn't exist".
 */

import { Link } from "react-router";
import { Compass } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0A0A0A] px-6">
      <div className="text-center max-w-md">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1E1E1E] border border-[#2A2A2A] flex items-center justify-center shadow-[0_0_20px_rgba(212,165,116,0.08)]">
          <Compass className="size-8 text-[#D4A574]" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">This page doesn't exist</h2>
        <p className="text-[#999] text-sm mb-6">
          The link might be old, or the address slightly off. Nothing's broken — you're just
          somewhere that isn't a page.
        </p>
        <Link
          to="/chat/new"
          className="inline-flex items-center gap-2 bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] font-semibold rounded-xl px-5 py-2.5 text-sm transition-all hover:shadow-[0_0_20px_rgba(212,165,116,0.2)] hover:brightness-110"
        >
          Back to Ask Antoine
        </Link>
      </div>
    </div>
  );
}
