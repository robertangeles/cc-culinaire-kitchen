import { useState } from "react";
import { X, Globe, Loader2, Link2, Network } from "lucide-react";

const CATEGORIES = ["techniques", "pastry", "spirits", "ingredients", "general"];

interface Props {
  onSubmit: (url: string, title: string, category: string, tags: string[], crawl: boolean) => Promise<void>;
  onClose: () => void;
}

export default function KnowledgeUrlDialog({ onSubmit, onClose }: Props) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [tagsInput, setTagsInput] = useState("");
  const [crawl, setCrawl] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) { setError("URL is required"); return; }
    if (!title.trim()) { setError("Title is required"); return; }

    try {
      new URL(url);
    } catch {
      setError("Invalid URL format");
      return;
    }

    setIsSubmitting(true);
    setError("");
    try {
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      await onSubmit(url.trim(), title.trim(), category, tags, crawl);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "URL submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-[#161616] rounded-xl shadow-2xl shadow-black/40 w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2A2A2A]">
          <h3 className="text-lg font-semibold text-[#FAFAFA]">Add URL</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#1E1E1E]">
            <X className="size-5 text-[#999999]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">URL</label>
            <div className="relative">
              <Globe className="absolute left-3 top-2.5 size-4 text-[#999999]" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-[#2A2A2A] rounded-lg text-sm focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]"
                placeholder="https://example.com/culinary-article"
              />
            </div>
          </div>

          {/* Crawl mode toggle */}
          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-2">Scrape Mode</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCrawl(false)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  !crawl
                    ? "border-[#D4A574] bg-[#D4A574]/10 text-[#D4A574]"
                    : "border-[#2A2A2A] bg-[#161616] text-[#E5E5E5] hover:bg-[#0A0A0A]"
                }`}
              >
                <Link2 className="size-4" />
                Single Page
              </button>
              <button
                type="button"
                onClick={() => setCrawl(true)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-lg border transition-colors ${
                  crawl
                    ? "border-[#D4A574] bg-[#D4A574]/10 text-[#D4A574]"
                    : "border-[#2A2A2A] bg-[#161616] text-[#E5E5E5] hover:bg-[#0A0A0A]"
                }`}
              >
                <Network className="size-4" />
                Crawl Site
              </button>
            </div>
            <p className="text-xs text-[#999999] mt-1.5">
              {crawl
                ? "Follows internal links from this page (max 20 pages). Each page becomes a separate document."
                : "Scrapes only the content from this single URL."}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-[#2A2A2A] rounded-lg text-sm focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]"
              placeholder={crawl ? "Site/collection title" : "Document title"}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-[#2A2A2A] rounded-lg text-sm focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#E5E5E5] mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full px-3 py-2 border border-[#2A2A2A] rounded-lg text-sm focus:ring-2 focus:ring-[#D4A574]/50 focus:border-[#D4A574]"
              placeholder="e.g. sauces, french, technique"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-medium text-[#E5E5E5] bg-[#1E1E1E] rounded-lg hover:bg-[#2A2A2A] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-white bg-[#D4A574] rounded-lg hover:bg-[#C4956A] disabled:opacity-50 transition-colors">
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              {crawl ? "Crawl & Add" : "Add URL"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
