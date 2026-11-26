import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BenchReportDialog } from "./BenchReportDialog.js";

const person = { userId: 7, userName: "Sam", userPhotoPath: null };
const messageId = "6f1c2a1e-3b5d-4c8a-9e2f-1a2b3c4d5e6f";

let answer: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

describe("BenchReportDialog", () => {
  beforeEach(() => {
    answer = { status: 201, body: { id: "r1" } };
    fetchMock = vi.fn(async () => ({ ok: answer.status < 400, status: answer.status, json: async () => answer.body }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  it("cannot send before a reason is chosen", () => {
    render(<BenchReportDialog target={{ person, messageId }} onClose={() => undefined} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("reports a message with its reason and note, then confirms", async () => {
    render(<BenchReportDialog target={{ person, messageId }} onClose={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Harassment or bullying"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  keeps posting this  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Thanks. A moderator will look at it.")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/bench\/reports$/);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(sent()).toEqual({ messageId, reason: "harassment", note: "keeps posting this" });
  });

  it("reports a person by id and leaves out an empty note", async () => {
    render(<BenchReportDialog target={{ person }} onClose={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Report Sam" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Spam or advertising"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Thanks. A moderator will look at it.");
    expect(sent()).toEqual({ userId: 7, reason: "spam" });
  });

  it("says plainly when today's limit is reached", async () => {
    answer = { status: 429, body: { error: "Too many reports", code: "RATE_LIMITED" } };
    render(<BenchReportDialog target={{ person, messageId }} onClose={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Something else"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You've sent the most reports allowed for today. Try again tomorrow.");
    expect(screen.queryByText("Thanks. A moderator will look at it.")).not.toBeInTheDocument();
  });

  it("shows the server's sentence for any other refusal", async () => {
    answer = { status: 400, body: { error: "You can't report your own message", code: "VALIDATION" } };
    render(<BenchReportDialog target={{ person, messageId }} onClose={() => undefined} />);
    fireEvent.click(screen.getByLabelText("Something else"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You can't report your own message");
  });
});
