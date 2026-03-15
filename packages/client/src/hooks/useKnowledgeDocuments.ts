/**
 * @module hooks/useKnowledgeDocuments
 *
 * React hook for managing knowledge documents in the admin UI.
 * Provides CRUD operations and auto-polling for processing status.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface KnowledgeDocument {
  documentId: number;
  title: string;
  category: string;
  tags: string[];
  sourceType: string;
  originalFilename: string | null;
  sourceUrl: string | null;
  fileSizeBytes: number | null;
  chunkCount: number;
  status: string;
  errorMessage: string | null;
  createdDttm: string;
}

interface ListResponse {
  documents: KnowledgeDocument[];
  total: number;
  page: number;
  limit: number;
}

export function useKnowledgeDocuments() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchDocuments = useCallback(async (p = page) => {
    try {
      const res = await fetch(`/api/knowledge?page=${p}&limit=20`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ListResponse = await res.json();
      setDocuments(data.documents);
      setTotal(data.total);
      setPage(data.page);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch documents");
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  // Initial fetch
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  // Auto-poll every 5s when any document is processing
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === "processing");

    if (hasProcessing && !pollTimer.current) {
      pollTimer.current = setInterval(() => fetchDocuments(), 5000);
    } else if (!hasProcessing && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [documents, fetchDocuments]);

  const uploadFile = useCallback(
    async (file: File, title: string, category: string, tags: string[]) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      formData.append("category", category);
      formData.append("tags", tags.join(","));

      const res = await fetch("/api/knowledge/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Upload failed (${res.status})`);
      }

      await fetchDocuments();
      return res.json();
    },
    [fetchDocuments],
  );

  const submitUrl = useCallback(
    async (url: string, title: string, category: string, tags: string[], crawl = false) => {
      const res = await fetch("/api/knowledge/url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, title, category, tags, crawl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `URL submission failed (${res.status})`);
      }

      await fetchDocuments();
      return res.json();
    },
    [fetchDocuments],
  );

  const addManual = useCallback(
    async (title: string, category: string, tags: string[], body: string) => {
      const res = await fetch("/api/knowledge/manual", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, tags, body }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Manual entry failed (${res.status})`);
      }

      await fetchDocuments();
      return res.json();
    },
    [fetchDocuments],
  );

  const reEmbed = useCallback(
    async (documentId: number) => {
      const res = await fetch(`/api/knowledge/${documentId}/re-embed`, {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Re-embed failed (${res.status})`);
      }

      await fetchDocuments();
    },
    [fetchDocuments],
  );

  const deleteDocument = useCallback(
    async (documentId: number) => {
      const res = await fetch(`/api/knowledge/${documentId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed (${res.status})`);
      }

      await fetchDocuments();
    },
    [fetchDocuments],
  );

  return {
    documents,
    total,
    page,
    setPage,
    isLoading,
    error,
    refresh: fetchDocuments,
    uploadFile,
    submitUrl,
    addManual,
    reEmbed,
    deleteDocument,
  };
}
