/**
 * @module components/settings/PagesTab
 *
 * Admin Settings → Pages tab. CMS-lite editor for static site_page rows
 * (Terms of Service, Privacy Policy, and any future admin-created pages).
 *
 * Layout:
 *   ┌──────────────────┬──────────────────────────────────────┐
 *   │  Page list       │  Editor (title / slug / publish)     │
 *   │  + New page      │  ─────────────────────────────────── │
 *   │                  │  Markdown textarea │ Live preview    │
 *   └──────────────────┴──────────────────────────────────────┘
 *
 * The two reserved slugs (terms, privacy) are seeded on server boot;
 * their slugs are read-only and the Delete button is hidden for them.
 */

import { useState, useEffect, useMemo } from "react";
import { Loader2, Plus, Save, Trash2, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { usePagesAdmin, type SitePage } from "../../hooks/useSitePages.js";

const RESERVED_SLUGS = new Set(["terms", "privacy"]);
const SLUG_RE = /^[a-z][a-z0-9-]{1,79}$/;

interface DraftState {
  slug: string;
  title: string;
  bodyMd: string;
  publishedInd: boolean;
  /** True when this is a brand-new page that hasn't been saved yet. */
  isNew: boolean;
}

function draftFrom(page: SitePage): DraftState {
  return {
    slug: page.slug,
    title: page.title,
    bodyMd: page.bodyMd,
    publishedInd: page.publishedInd,
    isNew: false,
  };
}

const NEW_DRAFT: DraftState = {
  slug: "",
  title: "",
  bodyMd: "",
  publishedInd: false,
  isNew: true,
};

export function PagesTab() {
  const { pages, loading, error, upsert, remove, refresh } = usePagesAdmin();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Default selection: first page once the list lands.
  useEffect(() => {
    if (selectedSlug || pages.length === 0) return;
    setSelectedSlug(pages[0].slug);
    setDraft(draftFrom(pages[0]));
  }, [pages, selectedSlug]);

  function pickPage(page: SitePage) {
    setSelectedSlug(page.slug);
    setDraft(draftFrom(page));
    setFeedback(null);
  }

  function startNew() {
    setSelectedSlug(null);
    setDraft({ ...NEW_DRAFT });
    setFeedback(null);
  }

  const slugError = useMemo(() => {
    if (!draft || !draft.isNew) return null;
    if (!draft.slug) return "Slug is required";
    if (!SLUG_RE.test(draft.slug)) return "Lowercase letters, numbers, and hyphens only";
    if (pages.some((p) => p.slug === draft.slug)) return "Slug already in use";
    return null;
  }, [draft, pages]);

  async function handleSave() {
    if (!draft) return;
    if (slugError) {
      setFeedback({ kind: "err", msg: slugError });
      return;
    }
    if (!draft.title.trim()) {
      setFeedback({ kind: "err", msg: "Title is required" });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await upsert(draft.slug, {
        title: draft.title.trim(),
        bodyMd: draft.bodyMd,
        publishedInd: draft.publishedInd,
      });
      setSelectedSlug(saved.slug);
      setDraft(draftFrom(saved));
      setFeedback({ kind: "ok", msg: "Saved" });
    } catch (err: any) {
      setFeedback({ kind: "err", msg: err?.message ?? "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!draft || draft.isNew || RESERVED_SLUGS.has(draft.slug)) return;
    if (!window.confirm(`Delete page "${draft.title}"? This cannot be undone.`)) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await remove(draft.slug);
      setSelectedSlug(null);
      setDraft(null);
      setFeedback({ kind: "ok", msg: "Page deleted" });
    } catch (err: any) {
      setFeedback({ kind: "err", msg: err?.message ?? "Delete failed" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex h-full">
      {/* Left rail: page list */}
      <div className="w-72 border-r border-[#2A2A2A] bg-[#0A0A0A] px-3 py-6 overflow-y-auto">
        <div className="flex items-center justify-between px-3 mb-4">
          <h2 className="text-sm font-semibold text-[#666] uppercase tracking-wider">Pages</h2>
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1 text-xs text-[#D4A574] hover:text-[#E5C594] transition-colors"
          >
            <Plus className="size-3" /> New
          </button>
        </div>

        {loading ? (
          <div className="px-3 py-4 text-[#666] inline-flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : error ? (
          <div className="px-3 py-2 rounded-lg bg-red-900/20 border border-red-700/40 text-red-300 text-xs">
            {error}
            <button onClick={refresh} className="block mt-1 underline">Retry</button>
          </div>
        ) : (
          <nav className="space-y-1">
            {pages.map((p) => {
              const isActive = selectedSlug === p.slug && !draft?.isNew;
              return (
                <button
                  key={p.slug}
                  onClick={() => pickPage(p)}
                  className={`w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                    isActive
                      ? "bg-[#1E1E1E] text-[#FAFAFA] shadow-[0_0_12px_rgba(212,165,116,0.15)] border border-[#D4A574]/30"
                      : "text-[#999] hover:bg-[#1E1E1E]/60 hover:text-[#FAFAFA] border border-transparent"
                  }`}
                >
                  <FileText className="size-4 mt-0.5 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{p.title}</span>
                    <span className="text-[10px] text-[#666] uppercase tracking-wide">/{p.slug}</span>
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium tracking-wide ${
                      p.publishedInd
                        ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                        : "bg-stone-500/10 text-stone-400 border border-stone-500/30"
                    }`}
                  >
                    {p.publishedInd ? "LIVE" : "DRAFT"}
                  </span>
                </button>
              );
            })}
            {draft?.isNew && (
              <div className="px-3 py-2 rounded-lg bg-[#1E1E1E] text-[#FAFAFA] border border-[#D4A574]/30 text-sm">
                <FileText className="size-4 inline-block mr-1.5" />
                {draft.title || "New page"}
                <span className="text-[10px] text-[#666] uppercase tracking-wide block">unsaved</span>
              </div>
            )}
          </nav>
        )}
      </div>

      {/* Right pane: editor */}
      <div className="flex-1 overflow-y-auto bg-[#0A0A0A] px-8 py-6">
        {!draft ? (
          <div className="text-center text-[#666] py-16">
            <FileText className="size-10 mx-auto mb-3 text-[#D4A574]/40" />
            <p>Select a page to edit, or create a new one.</p>
          </div>
        ) : (
          <div className="max-w-5xl space-y-5">
            <header>
              <h1 className="text-xl font-bold text-white">
                {draft.isNew ? "New page" : draft.title}
              </h1>
              <p className="text-sm text-[#999] mt-1">
                Markdown is rendered exactly as shown in the preview pane. Public visitors only see published pages.
              </p>
            </header>

            {feedback && (
              <div
                className={`px-3 py-2 rounded-lg text-sm inline-flex items-center gap-2 ${
                  feedback.kind === "ok"
                    ? "bg-emerald-900/20 border border-emerald-700/40 text-emerald-300"
                    : "bg-red-900/20 border border-red-700/40 text-red-300"
                }`}
              >
                {feedback.kind === "ok" ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
                {feedback.msg}
              </div>
            )}

            {/* Title + slug + publish */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase text-[#666] tracking-wide">Title</span>
                <input
                  type="text"
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-[#161616] border border-[#2A2A2A] text-white text-sm focus:outline-none focus:border-[#D4A574] focus:ring-1 focus:ring-[#D4A574]/40 transition-colors"
                  placeholder="Terms of Service"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs uppercase text-[#666] tracking-wide">
                  Slug {!draft.isNew && <span className="normal-case text-[10px] text-[#666]">(read-only)</span>}
                </span>
                <input
                  type="text"
                  value={draft.slug}
                  readOnly={!draft.isNew}
                  maxLength={80}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase() })}
                  className={`px-3 py-2 rounded-lg bg-[#161616] border text-sm focus:outline-none transition-colors ${
                    draft.isNew && slugError
                      ? "border-red-700/60 text-red-300"
                      : draft.isNew
                      ? "border-[#2A2A2A] text-white focus:border-[#D4A574] focus:ring-1 focus:ring-[#D4A574]/40"
                      : "border-[#2A2A2A] text-[#999] cursor-not-allowed"
                  }`}
                  placeholder="about"
                />
                {draft.isNew && slugError && (
                  <span className="text-xs text-red-400">{slugError}</span>
                )}
                {draft.isNew && !slugError && draft.slug && (
                  <span className="text-xs text-[#666]">Public URL: <code>/pages/{draft.slug}</code></span>
                )}
              </label>
            </div>

            <label className="inline-flex items-center gap-2 text-sm text-[#E5E5E5] cursor-pointer">
              <input
                type="checkbox"
                checked={draft.publishedInd}
                onChange={(e) => setDraft({ ...draft, publishedInd: e.target.checked })}
                className="size-4 rounded border-[#2A2A2A] bg-[#161616] text-[#D4A574] focus:ring-[#D4A574]/40"
              />
              Published — visible to the public at <code>/{draft.slug || "your-slug"}</code>
            </label>

            {/* Editor + preview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase text-[#666] tracking-wide">Body (Markdown)</span>
                <textarea
                  value={draft.bodyMd}
                  maxLength={100_000}
                  onChange={(e) => setDraft({ ...draft, bodyMd: e.target.value })}
                  className="min-h-[420px] px-4 py-3 rounded-xl bg-[#161616] border border-[#2A2A2A] text-white text-sm font-mono leading-relaxed focus:outline-none focus:border-[#D4A574] focus:ring-1 focus:ring-[#D4A574]/40 transition-colors resize-y"
                  placeholder="# Heading&#10;&#10;Body copy in markdown."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs uppercase text-[#666] tracking-wide">Live preview</span>
                <div className="min-h-[420px] px-5 py-4 rounded-xl bg-[#0F0F0F] border border-[#2A2A2A] overflow-y-auto">
                  {draft.bodyMd.trim() ? (
                    <div className="prose prose-invert prose-sm max-w-none prose-headings:text-[#FAFAFA] prose-p:text-[#E5E5E5] prose-strong:text-[#FAFAFA] prose-a:text-[#D4A574] prose-a:no-underline hover:prose-a:underline prose-li:text-[#E5E5E5] prose-code:text-[#D4A574] prose-code:bg-[#0A0A0A] prose-code:border prose-code:border-[#2A2A2A] prose-code:rounded prose-code:px-1 prose-code:py-0.5">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.bodyMd}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-[#666] text-sm italic">Preview appears here as you type.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving || (draft.isNew && !!slugError)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#D4A574] to-[#C4956A] text-[#0A0A0A] text-sm font-medium hover:from-[#E5C594] hover:to-[#D4A574] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-[0_0_12px_rgba(212,165,116,0.2)]"
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {saving ? "Saving…" : "Save"}
              </button>

              {!draft.isNew && !RESERVED_SLUGS.has(draft.slug) && (
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-700/40 text-red-300 text-sm font-medium hover:bg-red-900/20 disabled:opacity-50 transition-colors"
                >
                  {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete
                </button>
              )}

              {!draft.isNew && RESERVED_SLUGS.has(draft.slug) && (
                <span className="text-xs text-[#666] italic">Reserved page — cannot be deleted</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
