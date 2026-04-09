/**
 * @module GuideSidebar
 *
 * Collapsible right-hand sidebar that displays contextual guide content
 * for Intelligence pages. Determines the guide key from the current route,
 * fetches the matching guide, and renders it as styled markdown.
 */

import { useState, useEffect } from "react";
import { useLocation } from "react-router";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, X, Loader2 } from "lucide-react";
import { useGuide } from "../../context/GuideContext.js";

const API = import.meta.env.VITE_API_URL ?? "";

/** Maps route pathname to guide key. Returns null for non-guide routes. */
function guideKeyFromPath(pathname: string): string | null {
  if (pathname.startsWith("/waste-intelligence")) return "waste_intelligence";
  if (pathname.startsWith("/kitchen-copilot")) return "kitchen_copilot";
  if (pathname.startsWith("/menu-intelligence")) return "menu_intelligence";
  if (pathname.startsWith("/inventory")) return "inventory_dashboard"; // default; overridden by context
  return null;
}

const LS_KEY = "guide_sidebar_collapsed";

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(LS_KEY);
    return stored === "true";
  } catch {
    return true;
  }
}

/** Custom markdown component styles for guide content. */
const mdComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-[#D4A574] mt-4 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-[#D4A574] mt-4 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-[#D4A574] mt-3 mb-1">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="text-[#E5E5E5] text-sm leading-relaxed mb-2">{children}</p>
  ),
  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
  ul: ({ children }) => (
    <ul className="text-[#E5E5E5] text-sm list-disc ml-4 mb-2 marker:text-[#D4A574]">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="text-[#E5E5E5] text-sm list-decimal ml-4 mb-2 marker:text-[#D4A574]">{children}</ol>
  ),
  li: ({ children }) => <li className="mb-1 leading-relaxed">{children}</li>,
  code: ({ children, className }) => {
    // Block code vs inline code
    if (className) {
      return (
        <code className="block bg-[#1E1E1E] text-[#D4A574] rounded p-2 text-xs overflow-x-auto mb-2">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-[#1E1E1E] text-[#D4A574] rounded px-1 text-xs">{children}</code>
    );
  },
  a: ({ children, href }) => (
    <a href={href} className="text-[#D4A574] underline hover:text-[#C4956A]" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export function GuideSidebar() {
  const { pathname } = useLocation();
  const { guideKeyOverride } = useGuide();
  const routeKey = guideKeyFromPath(pathname);
  const guideKey = guideKeyOverride ?? routeKey;

  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("Guide");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist collapse state
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  // Fetch guide content when key changes
  useEffect(() => {
    if (!guideKey) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchGuide() {
      try {
        const res = await fetch(`${API}/api/guides/${guideKey}`, { credentials: "include" });
        if (!res.ok) {
          if (res.status === 404) {
            setContent("");
            setTitle("Guide");
            return;
          }
          throw new Error("Failed to load guide");
        }
        const data = await res.json();
        if (!cancelled) {
          setContent(data.content || "");
          setTitle(data.title || "Guide");
        }
      } catch {
        if (!cancelled) setError("Unable to load guide content");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchGuide();
    return () => {
      cancelled = true;
    };
  }, [guideKey]);

  // Don't render on routes that don't have guides
  if (!guideKey && !routeKey) return null;

  return (
    <div className="hidden md:flex h-full flex-shrink-0">
      {/* Toggle button — attached to right edge */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="relative flex items-start pt-3 px-1.5 transition-colors group"
        style={{
          background: collapsed ? "#131518" : "linear-gradient(180deg, #181B20 0%, #131518 100%)",
          borderLeft: `1px solid ${collapsed ? "rgba(100,130,180,0.1)" : "rgba(100,130,180,0.15)"}`,
        }}
        title={collapsed ? "Show guide" : "Hide guide"}
      >
        {/* Pulse ring — only when collapsed to hint "click me" */}
        {collapsed && (
          <span className="absolute top-2.5 left-1 w-5 h-5 rounded-full animate-ping opacity-[0.15]"
            style={{ backgroundColor: "#8BA4C4" }}
          />
        )}
        {/* Glow dot — persistent soft beacon when collapsed */}
        {collapsed && (
          <span className="absolute top-[7px] right-0.5 w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: "#8BA4C4",
              boxShadow: "0 0 6px rgba(139,164,196,0.5)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
        )}
        <BookOpen
          className={`size-4 transition-colors relative z-10 ${
            collapsed
              ? "text-[#8BA4C4] group-hover:text-white group-hover:scale-110 transition-transform"
              : "text-[#8BA4C4]"
          }`}
        />
      </button>

      {/* Sidebar panel */}
      <aside
        className={`flex flex-col overflow-hidden transition-all duration-200 ${
          collapsed ? "w-0" : "w-72"
        }`}
        style={{
          background: "linear-gradient(180deg, rgba(20,23,28,0.99) 0%, rgba(14,16,20,0.99) 100%)",
          borderLeft: "1px solid rgba(100,130,180,0.12)",
          boxShadow: "inset 1px 0 0 rgba(100,130,180,0.05), -4px 0 16px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-3 flex-shrink-0 flex items-center justify-between"
          style={{
            borderBottom: "1px solid rgba(100,130,180,0.1)",
            background: "linear-gradient(180deg, rgba(25,28,35,0.8) 0%, transparent 100%)",
          }}
        >
          <div className="flex items-center gap-2">
            <BookOpen className="size-4 text-[#8BA4C4]" />
            <h2 className="text-xs font-semibold text-[#8BA4C4] uppercase tracking-wider whitespace-nowrap">
              {title}
            </h2>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="text-[#555] hover:text-[#8BA4C4] transition-colors"
            title="Close guide"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="size-5 animate-spin text-[#D4A574]" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : content ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {content}
            </ReactMarkdown>
          ) : (
            <p className="text-sm text-[#666666] italic">No guide content available yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
