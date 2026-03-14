/**
 * @module knowledgeService
 *
 * Indexes and retrieves curated culinary knowledge from the markdown-based
 * knowledge base (`knowledge-base/`). On first query the service recursively
 * scans the knowledge base directory, parses each `.md` file with
 * gray-matter to extract front-matter metadata (title, category, tags) and
 * body content, then stores the results in an in-memory index.
 *
 * Search is performed via simple term-matching with weighted scoring:
 *   - title matches are weighted highest (10 per term)
 *   - tag matches next (8 per term)
 *   - body content matches lowest (3 per term)
 *
 * Results are sorted by descending score and capped at the top 5.
 */

import { readFile, readdir } from "fs/promises";
import { join, dirname, resolve, relative } from "path";
import { fileURLToPath } from "url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the knowledge-base directory at the repository root. */
const KNOWLEDGE_DIR = resolve(__dirname, "../../../../knowledge-base");

/** A single parsed knowledge-base entry held in the in-memory index. */
interface KnowledgeEntry {
  filePath: string;
  title: string;
  category: string;
  tags: string[];
  content: string;
}

/** A search result returned to callers, containing a text snippet for preview. */
interface SearchResult {
  filePath: string;
  title: string;
  category: string;
  snippet: string;
}

/** In-memory index populated lazily on the first search request. */
let index: KnowledgeEntry[] = [];

/**
 * Recursively scans a directory for `.md` files, parses front-matter
 * metadata with gray-matter, and returns an array of {@link KnowledgeEntry}
 * objects. Non-markdown files and unreadable directories are silently skipped.
 *
 * @param dir - Absolute path of the directory to scan.
 * @returns Array of parsed knowledge entries found under {@link dir}.
 */
async function scanDirectory(dir: string): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];

  let items: string[];
  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = await import("fs").then((fs) =>
      fs.promises.stat(fullPath)
    );

    if (stat.isDirectory()) {
      const nested = await scanDirectory(fullPath);
      entries.push(...nested);
    } else if (item.endsWith(".md")) {
      const raw = await readFile(fullPath, "utf-8");
      const { data, content } = matter(raw);
      const relativePath = relative(KNOWLEDGE_DIR, fullPath).replace(/\\/g, "/");

      entries.push({
        filePath: relativePath,
        title: (data.title as string) ?? item.replace(".md", ""),
        category: (data.category as string) ?? relative(KNOWLEDGE_DIR, dir).replace(/\\/g, "/"),
        tags: Array.isArray(data.tags) ? data.tags : [],
        content,
      });
    }
  }

  return entries;
}

/**
 * Builds (or rebuilds) the in-memory knowledge index by scanning the
 * entire knowledge-base directory. Called automatically on the first
 * search if the index is empty, but can also be invoked manually to
 * force a refresh.
 *
 * @returns Resolves when the index has been fully populated.
 */
export async function buildIndex(): Promise<void> {
  index = await scanDirectory(KNOWLEDGE_DIR);
}

/**
 * Searches the knowledge index for entries matching the given query string.
 * The query is split into whitespace-delimited terms that are matched
 * case-insensitively against each entry's title, tags, and content body.
 * Results are ranked by a weighted score and the top 5 are returned.
 *
 * If the index has not yet been built, it is built automatically before
 * the search executes.
 *
 * @param query    - Free-text search query (e.g. "searing scallops").
 * @param category - Optional category filter; when provided only entries
 *                   whose category exactly matches are considered.
 * @returns Up to 5 {@link SearchResult} objects sorted by relevance.
 */
export async function searchKnowledge(
  query: string,
  category?: string
): Promise<SearchResult[]> {
  if (index.length === 0) await buildIndex();

  const terms = query.toLowerCase().split(/\s+/);

  const scored = index
    .filter((entry) => !category || entry.category === category)
    .map((entry) => {
      let score = 0;
      const lowerContent = entry.content.toLowerCase();
      const lowerTitle = entry.title.toLowerCase();
      const lowerTags = entry.tags.map((t) => t.toLowerCase());

      for (const term of terms) {
        if (lowerTitle.includes(term)) score += 10;
        if (lowerTags.some((t) => t.includes(term))) score += 8;
        if (lowerContent.includes(term)) score += 3;
      }

      // Find a relevant snippet
      let snippet = "";
      const contentLines = entry.content.split("\n");
      for (const line of contentLines) {
        if (terms.some((t) => line.toLowerCase().includes(t)) && line.trim().length > 10) {
          snippet = line.trim().slice(0, 200);
          break;
        }
      }
      if (!snippet && contentLines.length > 0) {
        snippet = contentLines.find((l) => l.trim().length > 10)?.trim().slice(0, 200) ?? "";
      }

      return { entry, score, snippet };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return scored.map(({ entry, snippet }) => ({
    filePath: entry.filePath,
    title: entry.title,
    category: entry.category,
    snippet,
  }));
}

/**
 * Reads and parses a single knowledge-base markdown file by its relative
 * path within the knowledge-base directory. Includes path-traversal
 * protection to prevent access outside the knowledge-base root.
 *
 * @param filePath - Relative path from the knowledge-base root
 *                   (e.g. "techniques/searing.md").
 * @returns An object with `title`, `category`, and `content` fields,
 *          or `null` if the file does not exist or the path is invalid.
 */
export async function readKnowledgeFile(
  filePath: string
): Promise<{ title: string; category: string; content: string } | null> {
  // Path traversal protection
  const resolved = resolve(KNOWLEDGE_DIR, filePath);
  if (!resolved.startsWith(KNOWLEDGE_DIR)) {
    return null;
  }

  try {
    const raw = await readFile(resolved, "utf-8");
    const { data, content } = matter(raw);
    return {
      title: (data.title as string) ?? filePath,
      category: (data.category as string) ?? "",
      content: content.trim(),
    };
  } catch {
    return null;
  }
}
