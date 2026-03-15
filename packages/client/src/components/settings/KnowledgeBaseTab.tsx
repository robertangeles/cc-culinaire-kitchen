/**
 * @module components/settings/KnowledgeBaseTab
 *
 * Admin-only tab for managing the culinary knowledge base.
 * Organized into three sub-tabs:
 *   - File Knowledge: upload PDF/DOCX/TXT/MD
 *   - URL Knowledge: scrape web pages
 *   - Text Knowledge: manual text entry
 *
 * All ingested content is chunked, embedded, and searchable by the AI chatbot.
 */

import { useState } from "react";
import {
  Upload,
  Globe,
  FileText,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  FileUp,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useKnowledgeDocuments, type KnowledgeDocument } from "../../hooks/useKnowledgeDocuments";
import KnowledgeUploadDialog from "./KnowledgeUploadDialog";
import KnowledgeUrlDialog from "./KnowledgeUrlDialog";
import KnowledgeManualDialog from "./KnowledgeManualDialog";

type SubTab = "file" | "url" | "text";

const SUB_TABS: { id: SubTab; label: string; icon: typeof FileUp; sourceTypes: string[] }[] = [
  { id: "file", label: "File Knowledge", icon: FileUp, sourceTypes: ["pdf", "docx", "txt", "markdown"] },
  { id: "url", label: "URL Knowledge", icon: Globe, sourceTypes: ["url"] },
  { id: "text", label: "Text Knowledge", icon: FileText, sourceTypes: ["manual"] },
];

const SOURCE_ICONS: Record<string, typeof FileText> = {
  pdf: FileUp,
  docx: FileText,
  txt: FileText,
  markdown: FileText,
  url: Globe,
  manual: FileText,
};

function StatusBadge({ doc }: { doc: KnowledgeDocument }) {
  if (doc.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-full">
        <Loader2 className="size-3 animate-spin" /> Processing
      </span>
    );
  }
  if (doc.status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50 rounded-full">
        <CheckCircle2 className="size-3" /> Ready
      </span>
    );
  }
  return (
    <span className="group relative inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-red-700 bg-red-50 rounded-full cursor-help">
      <XCircle className="size-3" /> Failed
      {doc.errorMessage && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-stone-800 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap max-w-xs truncate z-10">
          {doc.errorMessage}
        </span>
      )}
    </span>
  );
}

function DocumentTable({
  documents,
  deleteConfirm,
  setDeleteConfirm,
  onDelete,
  onReEmbed,
}: {
  documents: KnowledgeDocument[];
  deleteConfirm: number | null;
  setDeleteConfirm: (id: number | null) => void;
  onDelete: (id: number) => void;
  onReEmbed: (id: number) => void;
}) {
  if (documents.length === 0) {
    return (
      <div className="text-center py-12 bg-stone-50 rounded-xl border border-stone-200">
        <FileText className="size-8 mx-auto text-stone-300 mb-2" />
        <p className="text-sm text-stone-500">No documents in this category yet.</p>
      </div>
    );
  }

  return (
    <div className="border border-stone-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-stone-50 border-b border-stone-200">
            <th className="text-left px-4 py-3 font-medium text-stone-600">Document</th>
            <th className="text-left px-4 py-3 font-medium text-stone-600">Category</th>
            <th className="text-center px-4 py-3 font-medium text-stone-600">Chunks</th>
            <th className="text-left px-4 py-3 font-medium text-stone-600">Status</th>
            <th className="text-right px-4 py-3 font-medium text-stone-600">Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const Icon = SOURCE_ICONS[doc.sourceType] || FileText;
            return (
              <tr key={doc.documentId} className="border-b border-stone-100 last:border-b-0 hover:bg-stone-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-stone-400 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-medium text-stone-900 truncate">{doc.title}</p>
                      {doc.originalFilename && (
                        <p className="text-xs text-stone-400 truncate">{doc.originalFilename}</p>
                      )}
                      {doc.sourceUrl && (
                        <p className="text-xs text-stone-400 truncate">{doc.sourceUrl}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="inline-block px-2 py-0.5 text-xs font-medium text-stone-600 bg-stone-100 rounded">
                    {doc.category}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-stone-600">{doc.chunkCount}</td>
                <td className="px-4 py-3"><StatusBadge doc={doc} /></td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onReEmbed(doc.documentId)}
                      disabled={doc.status === "processing"}
                      className="p-1.5 rounded hover:bg-stone-100 text-stone-500 hover:text-amber-600 disabled:opacity-30 transition-colors"
                      title="Re-embed"
                    >
                      <RefreshCw className="size-4" />
                    </button>
                    {deleteConfirm === doc.documentId ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onDelete(doc.documentId)}
                          className="px-2 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-2 py-1 text-xs font-medium text-stone-600 bg-stone-100 rounded hover:bg-stone-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(doc.documentId)}
                        className="p-1.5 rounded hover:bg-stone-100 text-stone-500 hover:text-red-600 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function KnowledgeBaseTab() {
  const {
    documents,
    total,
    page,
    setPage,
    isLoading,
    error,
    uploadFile,
    submitUrl,
    addManual,
    reEmbed,
    deleteDocument,
  } = useKnowledgeDocuments();

  const [subTab, setSubTab] = useState<SubTab>("file");
  const [dialog, setDialog] = useState<"upload" | "url" | "manual" | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const activeSubTab = SUB_TABS.find((t) => t.id === subTab)!;
  const filteredDocs = documents.filter((d) => activeSubTab.sourceTypes.includes(d.sourceType));
  const totalPages = Math.ceil(total / 20);

  const handleDelete = async (id: number) => {
    try {
      await deleteDocument(id);
      setDeleteConfirm(null);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleReEmbed = async (id: number) => {
    try {
      await reEmbed(id);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Re-embed failed");
    }
  };

  const addButtonConfig: Record<SubTab, { label: string; dialog: "upload" | "url" | "manual"; icon: typeof Upload }> = {
    file: { label: "Upload File", dialog: "upload", icon: Upload },
    url: { label: "Add URL", dialog: "url", icon: Globe },
    text: { label: "Add Text", dialog: "manual", icon: FileText },
  };

  const btn = addButtonConfig[subTab];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-amber-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Knowledge Base</h2>
          <p className="text-sm text-stone-500 mt-1">
            {total} document{total !== 1 ? "s" : ""} indexed
          </p>
        </div>
        <button
          onClick={() => setDialog(btn.dialog)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
        >
          <btn.icon className="size-4" /> {btn.label}
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        {SUB_TABS.map((tab) => {
          const TabIcon = tab.icon;
          const count = documents.filter((d) => tab.sourceTypes.includes(d.sourceType)).length;
          return (
            <button
              key={tab.id}
              onClick={() => { setSubTab(tab.id); setDeleteConfirm(null); }}
              className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                subTab === tab.id
                  ? "border-amber-600 text-amber-700"
                  : "border-transparent text-stone-500 hover:text-stone-700 hover:border-stone-300"
              }`}
            >
              <TabIcon className="size-4" />
              {tab.label}
              {count > 0 && (
                <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
                  subTab === tab.id ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-500"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Error banner */}
      {(error || actionError) && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-700 bg-red-50 rounded-lg">
          <AlertCircle className="size-4 flex-shrink-0" />
          {error || actionError}
        </div>
      )}

      {/* Document table for active sub-tab */}
      <DocumentTable
        documents={filteredDocs}
        deleteConfirm={deleteConfirm}
        setDeleteConfirm={setDeleteConfirm}
        onDelete={handleDelete}
        onReEmbed={handleReEmbed}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-stone-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="size-4" /> Previous
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-stone-600 bg-stone-100 rounded-lg hover:bg-stone-200 disabled:opacity-30 transition-colors"
            >
              Next <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      {dialog === "upload" && (
        <KnowledgeUploadDialog
          onSubmit={uploadFile}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "url" && (
        <KnowledgeUrlDialog
          onSubmit={submitUrl}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manual" && (
        <KnowledgeManualDialog
          onSubmit={addManual}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
