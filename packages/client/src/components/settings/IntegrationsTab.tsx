/**
 * @module IntegrationsTab
 *
 * Admin settings tab for managing encrypted integration credentials
 * (OAuth, AI, Email, Payments, Security). Credentials are stored
 * encrypted in the database and can be managed without editing .env files.
 *
 * The tab is organized into sub-tabs matching the credential categories,
 * with each sub-tab showing its relevant credentials in card form.
 */

import { useState, useEffect } from "react";
import { useSettings } from "../../context/SettingsContext.js";
import {
  Save,
  Loader2,
  AlertCircle,
  Check,
  Trash2,
  Eye,
  EyeOff,
  Database,
  Server,
  CircleAlert,
  KeyRound,
  Bot,
  Mail,
  CreditCard,
  Shield,
  ChevronDown,
  ChevronUp,
  Play,
  Terminal,
  AlertTriangle,
  Clock,
} from "lucide-react";

/** Shape of a single credential returned by the API. */
interface Credential {
  key: string;
  label: string;
  category: string;
  sensitive: boolean;
  value: string;
  hasValue: boolean;
  source: "db" | "env" | "none";
  updatedDttm: string | null;
}

/** Category metadata from the API. */
interface Category {
  id: string;
  label: string;
}

/** Map category IDs to their icons. */
const CATEGORY_ICONS: Record<string, typeof KeyRound> = {
  oauth: KeyRound,
  ai: Bot,
  email: Mail,
  payments: CreditCard,
  security: Shield,
  database: Database,
};

/** Badge showing the credential's source (DB, .env, or not set). */
function SourceBadge({ source }: { source: "db" | "env" | "none" }) {
  if (source === "db") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
        <Database className="size-2.5" />
        DB
      </span>
    );
  }
  if (source === "env") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">
        <Server className="size-2.5" />
        .env
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
      <CircleAlert className="size-2.5" />
      Not set
    </span>
  );
}

/**
 * Renders the Integrations settings tab with sub-tabs for each credential
 * category. Provides CRUD operations for encrypted credentials.
 */
export function IntegrationsTab() {
  const { refresh: refreshGlobalSettings } = useSettings();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({});
  const [revealingKey, setRevealingKey] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [activeTab, setActiveTab] = useState<string>("");

  /** Fetch all credentials and categories from the API. */
  async function fetchCredentials() {
    try {
      const res = await fetch("/api/credentials", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load credentials");
      const data = await res.json();
      setCredentials(data.credentials);
      setCategories(data.categories);
      if (!activeTab && data.categories.length > 0) {
        setActiveTab(data.categories[0].id);
      }
    } catch {
      setError("Failed to load credentials");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchCredentials();
  }, []);

  /** Start editing a credential field. */
  function startEditing(key: string) {
    setEditValues((prev) => ({ ...prev, [key]: "" }));
  }

  /** Cancel editing. */
  function cancelEditing(key: string) {
    setEditValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Save a single credential. */
  async function handleSave(key: string) {
    const value = editValues[key];
    if (value === undefined) return;

    setSavingKey(key);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ key, value }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save");
      }

      setSuccess(`${key} saved successfully`);
      cancelEditing(key);
      await fetchCredentials();
      await refreshGlobalSettings();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingKey(null);
    }
  }

  /** Delete a credential from DB (reverts to env fallback). */
  async function handleDelete(key: string) {
    setDeletingKey(key);
    setError("");
    setSuccess("");

    try {
      const res = await fetch(`/api/credentials/${key}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) throw new Error("Failed to delete");

      setSuccess(`${key} removed from database`);
      await fetchCredentials();
      await refreshGlobalSettings();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeletingKey(null);
    }
  }

  /** Toggle visibility for a sensitive credential via server-side reveal. */
  async function toggleReveal(key: string) {
    if (revealedKeys.has(key)) {
      // Hide — just remove from revealed state
      setRevealedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }

    // Reveal — fetch decrypted value from API
    setRevealingKey(key);
    try {
      const res = await fetch(`/api/credentials/${key}/reveal`, {
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to reveal credential");
      }
      const data = await res.json();
      setRevealedValues((prev) => ({ ...prev, [key]: data.value }));
      setRevealedKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRevealingKey(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-stone-400">
        <Loader2 className="size-5 animate-spin mr-2" />
        Loading credentials...
      </div>
    );
  }

  const activeCredentials = credentials.filter((c) => c.category === activeTab);

  /** Render a single credential card. Extracted to avoid duplicating JSX. */
  function renderCredentialCard(cred: Credential) {
    const isEditing = editValues[cred.key] !== undefined;
    const isRevealed = revealedKeys.has(cred.key);

    return (
      <div
        key={cred.key}
        className="flex items-start gap-4 p-4 rounded-lg border border-stone-200 bg-white"
      >
        {/* Label + source */}
        <div className="flex-shrink-0 w-48">
          <div className="text-sm font-medium text-stone-800">
            {cred.label}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <SourceBadge source={cred.source} />
          </div>
        </div>

        {/* Value / Edit */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type={cred.sensitive ? "password" : "text"}
                value={editValues[cred.key]}
                onChange={(e) =>
                  setEditValues((prev) => ({
                    ...prev,
                    [cred.key]: e.target.value,
                  }))
                }
                placeholder={`Enter ${cred.label}`}
                className="flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-800 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                autoFocus
              />
              <button
                onClick={() => handleSave(cred.key)}
                disabled={
                  savingKey === cred.key || !editValues[cred.key]
                }
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {savingKey === cred.key ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </button>
              <button
                onClick={() => cancelEditing(cred.key)}
                className="px-3 py-1.5 text-sm text-stone-500 hover:text-stone-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {cred.hasValue ? (
                <code className="text-sm text-stone-600 font-mono bg-stone-50 px-2 py-1 rounded">
                  {isRevealed && revealedValues[cred.key] ? revealedValues[cred.key] : cred.value}
                </code>
              ) : (
                <span className="text-sm text-stone-400 italic">
                  Not configured
                </span>
              )}
              {cred.sensitive && cred.hasValue && (
                <button
                  onClick={() => toggleReveal(cred.key)}
                  disabled={revealingKey === cred.key}
                  className="p-1 text-stone-400 hover:text-stone-600 disabled:opacity-50 transition-colors"
                  title={isRevealed ? "Hide" : "Show"}
                >
                  {revealingKey === cred.key ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : isRevealed ? (
                    <EyeOff className="size-3.5" />
                  ) : (
                    <Eye className="size-3.5" />
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => startEditing(cred.key)}
              className="px-3 py-1.5 text-sm text-stone-600 bg-white border border-stone-300 rounded-lg hover:bg-stone-50 transition-colors"
            >
              {cred.hasValue ? "Update" : "Set"}
            </button>
            {cred.source === "db" && (
              <button
                onClick={() => handleDelete(cred.key)}
                disabled={deletingKey === cred.key}
                className="p-1.5 text-stone-400 hover:text-red-600 transition-colors"
                title="Remove from database (revert to .env)"
              >
                {deletingKey === cred.key ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 py-6 border-b border-stone-200">
        <h1 className="text-xl font-semibold text-stone-900">Integrations</h1>
        <p className="mt-1 text-sm text-stone-500">
          Manage API keys, OAuth credentials, and integration settings.
          Values are encrypted at rest in the database.
        </p>
      </div>

      {/* Category sub-tabs */}
      <div className="px-8 pt-4 border-b border-stone-200">
        <div role="tablist" aria-label="Integration categories" className="flex gap-1">
          {categories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id] ?? KeyRound;
            const catCount = credentials.filter((c) => c.category === cat.id).length;
            const isActive = activeTab === cat.id;

            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`integrations-tabpanel-${cat.id}`}
                id={`integrations-tab-${cat.id}`}
                onClick={() => setActiveTab(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-t-lg transition-colors border-b-2 -mb-px ${
                  isActive
                    ? "text-amber-700 border-amber-600 bg-amber-50/50"
                    : "text-stone-500 border-transparent hover:text-stone-700 hover:bg-stone-50"
                }`}
              >
                <Icon className="size-3.5" />
                {cat.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                  isActive ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-400"
                }`}>
                  {catCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Credential list for active category */}
      <div
        role="tabpanel"
        id={`integrations-tabpanel-${activeTab}`}
        aria-labelledby={`integrations-tab-${activeTab}`}
        className="flex-1 overflow-y-auto px-8 py-6 space-y-3"
      >
        {activeCredentials.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-8">
            No credentials in this category.
          </p>
        ) : activeTab === "oauth" ? (
          <>
            {/* Google subsection */}
            <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mb-3">Google</h3>
            {activeCredentials
              .filter((c) => c.key.toLowerCase().includes("google"))
              .map((cred) => renderCredentialCard(cred))}

            {/* Microsoft subsection */}
            <h3 className="text-sm font-semibold text-stone-700 uppercase tracking-wider mt-6 mb-3">Microsoft</h3>
            {activeCredentials
              .filter((c) => c.key.toLowerCase().includes("microsoft"))
              .map((cred) => renderCredentialCard(cred))}
          </>
        ) : (
          activeCredentials.map((cred) => renderCredentialCard(cred))
        )}

        {/* Database storage viewer */}
        {activeTab === "database" && <DatabaseStorageViewer />}
      </div>

      {/* Bottom bar */}
      <div className="px-8 py-4 border-t border-stone-200 bg-stone-50 flex items-center justify-end gap-3">
        {error && (
          <span className="flex items-center gap-1.5 text-sm text-red-600">
            <AlertCircle className="size-4" />
            {error}
          </span>
        )}
        {success && (
          <span className="flex items-center gap-1.5 text-sm text-green-600">
            <Check className="size-4" />
            {success}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Database Storage Viewer
// ---------------------------------------------------------------------------

interface TableStat {
  tableName: string;
  rowCount: number;
  totalSize: string;
  totalBytes: number;
  dataSize: string;
  indexSize: string;
}

interface DbStats {
  totalSize: string;
  totalBytes: number;
  embeddingCount: number;
  tables: TableStat[];
}

function DatabaseStorageViewer() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);

  // Query tool state
  const [query, setQuery] = useState("");
  const [queryResult, setQueryResult] = useState<{ columns: string[]; rows: unknown[][]; rowCount: number; duration: number } | null>(null);
  const [queryError, setQueryError] = useState("");
  const [querying, setQuerying] = useState(false);

  async function fetchStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/database/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStats(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchStats(); }, []);

  async function executeQuery() {
    if (!query.trim()) return;
    setQuerying(true);
    setQueryError("");
    setQueryResult(null);
    try {
      const res = await fetch("/api/admin/database/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Query failed");
      setQueryResult(data);
    } catch (err) {
      setQueryError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setQuerying(false);
    }
  }

  const maxBytes = stats?.tables?.[0]?.totalBytes ?? 1;

  return (
    <div className="mt-6 border-t border-stone-200 pt-6 space-y-6">
      {/* ─── Storage Overview (collapsible) ─────────────────── */}
      <div>
        <button
          onClick={() => { setStorageOpen(!storageOpen); if (!stats) fetchStats(); }}
          className="w-full flex items-center justify-between"
        >
          <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2">
            <Server className="size-4 text-stone-400" />
            Storage Overview
          </h3>
          {storageOpen ? <ChevronUp className="size-4 text-stone-400" /> : <ChevronDown className="size-4 text-stone-400" />}
        </button>

        {storageOpen && (
          <div className="mt-3">
            <div className="flex justify-end mb-2">
              <button onClick={fetchStats} disabled={loading} className="text-xs text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50">
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 mb-4">
                <CircleAlert className="size-4" /> {error}
              </div>
            )}

            {stats && (
              <>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="bg-stone-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-stone-500">Total Size</p>
                    <p className="text-lg font-bold text-stone-800">{stats.totalSize}</p>
                  </div>
                  <div className="bg-stone-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-stone-500">Tables</p>
                    <p className="text-lg font-bold text-stone-800">{stats.tables.length}</p>
                  </div>
                  <div className="bg-stone-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-stone-500">Embeddings</p>
                    <p className="text-lg font-bold text-stone-800">{stats.embeddingCount.toLocaleString()}</p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 text-left">
                        <th className="py-2 pr-3 font-medium text-stone-600">Table</th>
                        <th className="py-2 pr-3 font-medium text-stone-600 text-right">Rows</th>
                        <th className="py-2 pr-3 font-medium text-stone-600 text-right">Size</th>
                        <th className="py-2 pr-3 font-medium text-stone-600 text-right">Data</th>
                        <th className="py-2 pr-3 font-medium text-stone-600 text-right">Indexes</th>
                        <th className="py-2 font-medium text-stone-600" style={{ width: "120px" }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.tables.map((t) => (
                        <tr key={t.tableName} className="border-b border-stone-100">
                          <td className="py-2 pr-3 text-stone-800 font-mono text-xs">{t.tableName}</td>
                          <td className="py-2 pr-3 text-stone-600 text-right">{t.rowCount.toLocaleString()}</td>
                          <td className="py-2 pr-3 text-stone-600 text-right">{t.totalSize}</td>
                          <td className="py-2 pr-3 text-stone-400 text-right">{t.dataSize}</td>
                          <td className="py-2 pr-3 text-stone-400 text-right">{t.indexSize}</td>
                          <td className="py-2">
                            <div className="w-full bg-stone-100 rounded-full h-2">
                              <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${Math.max(2, (t.totalBytes / maxBytes) * 100)}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {loading && !stats && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-amber-600" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ─── SQL Query Tool ──────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-2 mb-3">
          <Terminal className="size-4 text-stone-400" />
          Query Tool
        </h3>

        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-600 flex-shrink-0" />
          <p className="text-xs text-amber-800">Direct database access. Use with caution.</p>
        </div>

        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SELECT * FROM recipe LIMIT 10;"
          rows={4}
          className="w-full px-3 py-2 text-sm font-mono border border-stone-200 rounded-lg bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-400/50 focus:bg-white resize-none"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) executeQuery(); }}
        />

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-stone-400">Ctrl+Enter to execute</span>
          <button
            onClick={executeQuery}
            disabled={querying || !query.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {querying ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Execute
          </button>
        </div>

        {queryError && (
          <div className="mt-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <CircleAlert className="size-4 flex-shrink-0" /> {queryError}
          </div>
        )}

        {queryResult && (
          <div className="mt-3">
            <div className="flex items-center gap-3 text-xs text-stone-500 mb-2">
              <span>{queryResult.rowCount} row{queryResult.rowCount !== 1 ? "s" : ""}</span>
              <span className="flex items-center gap-1"><Clock className="size-3" /> {queryResult.duration}ms</span>
            </div>

            {queryResult.columns.length > 0 ? (
              <div className="overflow-x-auto border border-stone-200 rounded-lg max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-stone-100">
                    <tr>
                      {queryResult.columns.map((col) => (
                        <th key={col} className="px-3 py-2 text-left font-medium text-stone-600 border-b border-stone-200 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {queryResult.rows.map((row, i) => (
                      <tr key={i} className="border-b border-stone-100 hover:bg-stone-50">
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-1.5 text-stone-700 whitespace-nowrap max-w-xs truncate">
                            {cell === null ? <span className="text-stone-300 italic">NULL</span> : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-stone-500">Query executed successfully. No rows returned.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
