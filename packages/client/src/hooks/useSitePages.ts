/**
 * @module hooks/useSitePages
 *
 * Two hooks:
 *   - usePagesAdmin — admin Settings → Pages tab. Lists every page,
 *     supports upsert + delete.
 *   - usePublicPage — public renderer. Fetches one published page or
 *     surfaces a 404 status to the caller.
 */

import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL ?? "";

export interface SitePage {
  pageId: string;
  slug: string;
  title: string;
  bodyMd: string;
  publishedInd: boolean;
  createdDttm: string;
  updatedDttm: string;
}

export interface UpsertPageInput {
  title: string;
  bodyMd: string;
  publishedInd: boolean;
}

// ── Admin ────────────────────────────────────────────────

export function usePagesAdmin() {
  const [pages, setPages] = useState<SitePage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/admin/site-pages`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error ?? `Failed to load pages (${res.status})`);
        return;
      }
      setPages(await res.json());
    } catch (err: any) {
      setError(err?.message ?? "Failed to load pages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const upsert = useCallback(async (slug: string, input: UpsertPageInput): Promise<SitePage> => {
    const res = await fetch(`${API}/api/admin/site-pages/${encodeURIComponent(slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `Failed to save (${res.status})`);
    }
    const saved = await res.json();
    await refresh();
    return saved;
  }, [refresh]);

  const remove = useCallback(async (slug: string): Promise<void> => {
    const res = await fetch(`${API}/api/admin/site-pages/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? `Failed to delete (${res.status})`);
    }
    await refresh();
  }, [refresh]);

  return { pages, loading, error, refresh, upsert, remove };
}

// ── Public ───────────────────────────────────────────────

export type PublicPageState =
  | { status: "loading" }
  | { status: "ok"; page: SitePage }
  | { status: "not-found" }
  | { status: "error"; message: string };

export function usePublicPage(slug: string): PublicPageState {
  const [state, setState] = useState<PublicPageState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`${API}/api/site-pages/${encodeURIComponent(slug)}`);
        if (cancelled) return;
        if (res.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setState({ status: "error", message: body?.error ?? `HTTP ${res.status}` });
          return;
        }
        const page = (await res.json()) as SitePage;
        setState({ status: "ok", page });
      } catch (err: any) {
        if (!cancelled) setState({ status: "error", message: err?.message ?? "Network error" });
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  return state;
}
