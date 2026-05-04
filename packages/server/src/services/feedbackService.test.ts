import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for feedbackService — exercises the insert path and the async
 * email retry job. Schema imports are stubbed so the test never touches
 * a real database connection.
 *
 * The retry job's exponential-backoff math is the most interesting bit:
 *   - attempts=0  → run immediately
 *   - attempts=1  → wait 15 min from createdDttm
 *   - attempts=2  → wait 30 min
 *   - attempts=5  → skipped entirely (cap)
 */

// vi.mock is hoisted to the top of the file, so any references it uses
// must come from vi.hoisted() — plain top-level consts aren't yet
// initialized when the factory runs.
const h = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockInsertValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockSelectRows: unknown[] = [];
  const mockUpdateSet = vi.fn(() => ({ where: vi.fn(async () => undefined) }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));
  return { mockReturning, mockInsertValues, mockInsert, mockSelectRows, mockUpdateSet, mockUpdate };
});
const { mockReturning, mockInsertValues, mockInsert, mockSelectRows, mockUpdateSet, mockUpdate } = h;

vi.mock("../db/index.js", () => ({
  db: {
    insert: h.mockInsert,
    update: h.mockUpdate,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => h.mockSelectRows),
      })),
    })),
  },
}));

vi.mock("../db/schema.js", () => ({
  ckmFeedback: {
    feedbackId: "feedback_id",
    userId: "user_id",
    anonymousInd: "anonymous_ind",
    category: "category",
    subject: "subject",
    body: "body",
    appVersion: "app_version",
    deviceInfo: "device_info",
    screenshotBase64: "screenshot_base64",
    emailSentDttm: "email_sent_dttm",
    emailSendAttempts: "email_send_attempts",
    createdDttm: "created_dttm",
  },
}));

const r = vi.hoisted(() => ({ mockSend: vi.fn() }));
const { mockSend } = r;
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: r.mockSend },
  })),
}));

import {
  saveFeedback,
  processPendingFeedbackEmails,
} from "./feedbackService.js";

describe("saveFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.length = 0;
  });

  it("inserts and returns id + ISO createdDttm", async () => {
    const date = new Date("2026-05-04T12:00:00Z");
    mockReturning.mockResolvedValueOnce([
      { feedbackId: 99, createdDttm: date },
    ]);

    const result = await saveFeedback({
      userId: 7,
      isAnonymous: false,
      category: "bug",
      subject: "Crash",
      body: "Tapping share crashes",
      appVersion: "1.3.0",
      deviceInfo: {
        device_model: "Pixel 8",
        os_name: "android",
        os_version: "14",
        locale: "en-AU",
        app_version: "1.3.0",
      },
      screenshotBase64: null,
    });

    expect(result.id).toBe(99);
    expect(result.createdDttm).toBe("2026-05-04T12:00:00.000Z");
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        anonymousInd: false,
        category: "bug",
        appVersion: "1.3.0",
      }),
    );
  });

  it("threads userId=null + anonymousInd=true for anon submissions", async () => {
    mockReturning.mockResolvedValueOnce([
      { feedbackId: 100, createdDttm: new Date() },
    ]);

    await saveFeedback({
      userId: null,
      isAnonymous: true,
      category: "feedback",
      subject: "Love it",
      body: "App is great",
      appVersion: "1.3.0",
      deviceInfo: null,
      screenshotBase64: null,
    });

    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, anonymousInd: true, deviceInfo: null }),
    );
  });

  it("throws if the insert returns no row", async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(
      saveFeedback({
        userId: null,
        isAnonymous: true,
        category: "bug",
        subject: "x",
        body: "y",
        appVersion: "1.3.0",
        deviceInfo: null,
        screenshotBase64: null,
      }),
    ).rejects.toThrow(/no row/i);
  });
});

describe("processPendingFeedbackEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectRows.length = 0;
    process.env.RESEND_API_KEY = "test-key";
  });

  it("no-ops cleanly when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    // Reset module cache so the lazy Resend client re-checks env.
    vi.resetModules();
    const { processPendingFeedbackEmails: fresh } = await import(
      "./feedbackService.js"
    );
    const result = await fresh();
    expect(result).toEqual({ attempted: 0, sent: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends plaintext email and marks the row as sent on Resend success", async () => {
    mockSelectRows.push({
      feedbackId: 5,
      userId: 7,
      anonymousInd: false,
      category: "bug",
      subject: "Crash",
      body: "<script>alert(1)</script>",
      appVersion: "1.3.0",
      deviceInfo: null,
      screenshotBase64: null,
      emailSentDttm: null,
      emailSendAttempts: 0,
      createdDttm: new Date(),
    });
    mockSend.mockResolvedValueOnce({ data: { id: "msg_1" }, error: null });

    const result = await processPendingFeedbackEmails();

    expect(result).toEqual({ attempted: 1, sent: 1, failed: 0 });
    // CRITICAL: must use `text:` (plaintext) — never `html:` — so any
    // <script>/HTML in the user-submitted body cannot execute in the
    // recipient's email client. Privacy invariant from needs-frontend.md.
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("<script>alert(1)</script>"),
      }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.not.objectContaining({ html: expect.anything() }),
    );
    // Subject prefix uses category and ANON tag rules.
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("[CK Mobile Bug]") }),
    );
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("flags ANON in the subject for anonymous submissions", async () => {
    mockSelectRows.push({
      feedbackId: 6,
      userId: null,
      anonymousInd: true,
      category: "feedback",
      subject: "thanks",
      body: "love it",
      appVersion: "1.3.0",
      deviceInfo: null,
      screenshotBase64: null,
      emailSentDttm: null,
      emailSendAttempts: 0,
      createdDttm: new Date(),
    });
    mockSend.mockResolvedValueOnce({ data: { id: "msg_2" }, error: null });

    await processPendingFeedbackEmails();

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ subject: expect.stringContaining("[ANON]") }),
    );
  });

  it("attaches the screenshot when present", async () => {
    mockSelectRows.push({
      feedbackId: 7,
      userId: 1,
      anonymousInd: false,
      category: "bug",
      subject: "ui glitch",
      body: "see screenshot",
      appVersion: "1.3.0",
      deviceInfo: null,
      screenshotBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
      emailSentDttm: null,
      emailSendAttempts: 0,
      createdDttm: new Date(),
    });
    mockSend.mockResolvedValueOnce({ data: { id: "msg_3" }, error: null });

    await processPendingFeedbackEmails();

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: expect.stringContaining("feedback-7") }),
        ]),
      }),
    );
  });

  it("skips rows still inside their backoff window", async () => {
    // attempts=1 → must wait 15 min from createdDttm.
    mockSelectRows.push({
      feedbackId: 8,
      userId: null,
      anonymousInd: true,
      category: "bug",
      subject: "x",
      body: "y",
      appVersion: "1.3.0",
      deviceInfo: null,
      screenshotBase64: null,
      emailSentDttm: null,
      emailSendAttempts: 1,
      createdDttm: new Date(Date.now() - 60_000), // 1 min ago — too soon
    });

    const result = await processPendingFeedbackEmails();

    expect(result).toEqual({ attempted: 1, sent: 0, failed: 0 });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("increments attempts on Resend error (no email_sent_dttm set)", async () => {
    mockSelectRows.push({
      feedbackId: 9,
      userId: 1,
      anonymousInd: false,
      category: "bug",
      subject: "x",
      body: "y",
      appVersion: "1.3.0",
      deviceInfo: null,
      screenshotBase64: null,
      emailSentDttm: null,
      emailSendAttempts: 0,
      createdDttm: new Date(),
    });
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: "rate limited", name: "rate_limit" },
    });

    const result = await processPendingFeedbackEmails();
    expect(result).toEqual({ attempted: 1, sent: 0, failed: 1 });
    // The set() call should bump email_send_attempts, NOT touch email_sent_dttm.
    const setArg = mockUpdateSet.mock.calls.at(-1)?.[0];
    expect(setArg).toEqual(expect.objectContaining({ emailSendAttempts: expect.anything() }));
    expect(setArg).not.toHaveProperty("emailSentDttm");
  });
});
