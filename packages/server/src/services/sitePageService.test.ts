import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for sitePageService — focused on the load-bearing behaviour:
 *   - Reserved slugs (terms, privacy) cannot be deleted.
 *   - Public read returns null on draft rows.
 *   - Idempotent seed inserts only when missing.
 */

// ── Mocks ─────────────────────────────────────────────────────────────

const mockSelectRows: Array<unknown[]> = [];
let selectCallIdx = 0;
const mockInsertValues = vi.fn();
const mockUpdateSet = vi.fn();
const mockDeleteWhereReturning = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => {
          const rows = mockSelectRows[selectCallIdx] ?? [];
          if (selectCallIdx < mockSelectRows.length - 1) selectCallIdx++;
          return rows;
        }),
        orderBy: vi.fn(async () => mockSelectRows[selectCallIdx] ?? []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((vals) => {
        mockInsertValues(vals);
        return { returning: vi.fn(async () => [vals]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((vals) => {
        mockUpdateSet(vals);
        return {
          where: vi.fn(() => ({ returning: vi.fn(async () => [vals]) })),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({ returning: mockDeleteWhereReturning })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  sitePage: {
    pageId: "page_id",
    slug: "slug",
    title: "title",
    bodyMd: "body_md",
    publishedInd: "published_ind",
    updatedDttm: "updated_dttm",
  },
}));

beforeEach(() => {
  mockSelectRows.length = 0;
  selectCallIdx = 0;
  mockInsertValues.mockClear();
  mockUpdateSet.mockClear();
  mockDeleteWhereReturning.mockReset();
  vi.clearAllMocks();
});

function setRows(...rowsByCall: unknown[][]) {
  mockSelectRows.push(...rowsByCall);
  selectCallIdx = 0;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("deletePage — reserved slug guard", () => {
  it("refuses to delete the terms slug", async () => {
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("terms");
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/reserved/i);
    expect(mockDeleteWhereReturning).not.toHaveBeenCalled();
  });

  it("refuses to delete the privacy slug", async () => {
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("privacy");
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/reserved/i);
  });

  it("deletes a non-reserved slug", async () => {
    mockDeleteWhereReturning.mockResolvedValueOnce([{ pageId: "p1" }]);
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("about");
    expect(result.deleted).toBe(true);
  });

  it("returns deleted=false when slug does not exist", async () => {
    mockDeleteWhereReturning.mockResolvedValueOnce([]);
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("missing-slug");
    expect(result.deleted).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

describe("getPublishedPageBySlug — published gate", () => {
  it("returns null when the row is in draft (publishedInd=false)", async () => {
    setRows([{ slug: "terms", title: "Terms", bodyMd: "x", publishedInd: false }]);
    const { getPublishedPageBySlug } = await import("./sitePageService.js");
    const page = await getPublishedPageBySlug("terms");
    expect(page).toBeNull();
  });

  it("returns the page when publishedInd=true", async () => {
    setRows([{ slug: "terms", title: "Terms", bodyMd: "live copy", publishedInd: true }]);
    const { getPublishedPageBySlug } = await import("./sitePageService.js");
    const page = await getPublishedPageBySlug("terms");
    expect(page).not.toBeNull();
    expect(page?.bodyMd).toBe("live copy");
  });

  it("returns null when the row does not exist", async () => {
    setRows([]);
    const { getPublishedPageBySlug } = await import("./sitePageService.js");
    const page = await getPublishedPageBySlug("nope");
    expect(page).toBeNull();
  });
});

describe("ensureSeededPages — idempotent", () => {
  it("inserts both reserved slugs when neither exists", async () => {
    setRows([], []); // first lookup empty, second lookup empty
    const { ensureSeededPages } = await import("./sitePageService.js");
    await ensureSeededPages();
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
    const slugs = mockInsertValues.mock.calls.map((c) => c[0].slug).sort();
    expect(slugs).toEqual(["privacy", "terms"]);
  });

  it("does not re-insert when both reserved slugs already exist", async () => {
    setRows([{ pageId: "p1" }], [{ pageId: "p2" }]);
    const { ensureSeededPages } = await import("./sitePageService.js");
    await ensureSeededPages();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
