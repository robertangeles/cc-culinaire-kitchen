import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for sitePageService — focused on the load-bearing behaviour:
 *   - Reserved slugs (terms, privacy, delete-account) cannot be deleted on any surface.
 *   - Public read returns null on draft rows.
 *   - Idempotent seed inserts only when missing — across all surfaces.
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
    surface: "surface",
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
  it("refuses to delete the terms slug on web", async () => {
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("terms", "web");
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/reserved/i);
    expect(mockDeleteWhereReturning).not.toHaveBeenCalled();
  });

  it("refuses to delete the terms slug on mobile", async () => {
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("terms", "mobile");
    expect(result.deleted).toBe(false);
    expect(result.reason).toMatch(/reserved/i);
  });

  it("refuses to delete the privacy slug on either surface", async () => {
    const { deletePage } = await import("./sitePageService.js");
    expect((await deletePage("privacy", "web")).deleted).toBe(false);
    expect((await deletePage("privacy", "mobile")).deleted).toBe(false);
  });

  it("refuses to delete the delete-account slug on either surface", async () => {
    const { deletePage } = await import("./sitePageService.js");
    const web = await deletePage("delete-account", "web");
    const mobile = await deletePage("delete-account", "mobile");
    expect(web.deleted).toBe(false);
    expect(web.reason).toMatch(/reserved/i);
    expect(mobile.deleted).toBe(false);
    expect(mockDeleteWhereReturning).not.toHaveBeenCalled();
  });

  it("deletes a non-reserved slug when scoped to the right surface", async () => {
    mockDeleteWhereReturning.mockResolvedValueOnce([{ pageId: "p1" }]);
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("about", "mobile");
    expect(result.deleted).toBe(true);
  });

  it("returns deleted=false when slug does not exist on the target surface", async () => {
    mockDeleteWhereReturning.mockResolvedValueOnce([]);
    const { deletePage } = await import("./sitePageService.js");
    const result = await deletePage("missing-slug", "web");
    expect(result.deleted).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});

describe("getPublishedPageBySlug — published gate", () => {
  it("returns null when the row is in draft (publishedInd=false)", async () => {
    setRows([{ slug: "terms", surface: "web", title: "Terms", bodyMd: "x", publishedInd: false }]);
    const { getPublishedPageBySlug } = await import("./sitePageService.js");
    const page = await getPublishedPageBySlug("terms", "web");
    expect(page).toBeNull();
  });

  it("returns the page when publishedInd=true on the requested surface", async () => {
    setRows([{ slug: "terms", surface: "mobile", title: "Mobile Terms", bodyMd: "live mobile copy", publishedInd: true }]);
    const { getPublishedPageBySlug } = await import("./sitePageService.js");
    const page = await getPublishedPageBySlug("terms", "mobile");
    expect(page).not.toBeNull();
    expect(page?.bodyMd).toBe("live mobile copy");
  });

  it("returns null when the row does not exist on the requested surface", async () => {
    setRows([]);
    const { getPublishedPageBySlug } = await import("./sitePageService.js");
    const page = await getPublishedPageBySlug("nope", "mobile");
    expect(page).toBeNull();
  });
});

describe("ensureSeededPages — idempotent across surfaces", () => {
  it("inserts terms + privacy + delete-account on every surface when none exist", async () => {
    // Service iterates surfaces × seeds = 2 surfaces × 3 slugs = 6 inserts.
    setRows([], [], [], [], [], []);
    const { ensureSeededPages } = await import("./sitePageService.js");
    await ensureSeededPages();
    expect(mockInsertValues).toHaveBeenCalledTimes(6);
    const inserted = mockInsertValues.mock.calls.map((c) => `${c[0].surface}/${c[0].slug}`).sort();
    expect(inserted).toEqual([
      "mobile/delete-account",
      "mobile/privacy",
      "mobile/terms",
      "web/delete-account",
      "web/privacy",
      "web/terms",
    ]);
  });

  it("does not re-insert when every (surface, slug) combination already exists", async () => {
    setRows(
      [{ pageId: "p1" }], [{ pageId: "p2" }], [{ pageId: "p3" }],
      [{ pageId: "p4" }], [{ pageId: "p5" }], [{ pageId: "p6" }],
    );
    const { ensureSeededPages } = await import("./sitePageService.js");
    await ensureSeededPages();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});
