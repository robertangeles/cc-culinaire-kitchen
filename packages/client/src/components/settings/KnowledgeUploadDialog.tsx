import { useState, useRef } from "react";
import { X, Upload, Loader2 } from "lucide-react";

const CATEGORIES = ["techniques", "pastry", "spirits", "ingredients", "general"];
const ACCEPTED_TYPES = ".pdf,.docx,.txt,.md";

interface Props {
  onSubmit: (file: File, title: string, category: string, tags: string[]) => Promise<void>;
  onClose: () => void;
}

export default function KnowledgeUploadDialog({ onSubmit, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [tagsInput, setTagsInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError("Please select a file"); return; }
    if (!title.trim()) { setError("Title is required"); return; }

    setIsSubmitting(true);
    setError("");
    try {
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      await onSubmit(file, title.trim(), category, tags);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-200">
          <h3 className="text-lg font-semibold text-stone-900">Upload Document</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-stone-100">
            <X className="size-5 text-stone-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* File dropzone */}
          <div
            onClick={() => fileRef.current?.click()}
            className="border-2 border-dashed border-stone-300 rounded-lg p-6 text-center cursor-pointer hover:border-amber-400 transition-colors"
          >
            <Upload className="size-8 mx-auto text-stone-400 mb-2" />
            {file ? (
              <p className="text-sm text-stone-700 font-medium">{file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)</p>
            ) : (
              <p className="text-sm text-stone-500">Click to select PDF, DOCX, TXT, or MD file (max 100MB)</p>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              placeholder="Document title"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Tags (comma-separated)</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
              placeholder="e.g. heat, maillard, protein"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {isSubmitting && <Loader2 className="size-4 animate-spin" />}
              Upload
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
