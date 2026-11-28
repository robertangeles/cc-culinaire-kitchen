import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { BenchModerationPage } from "./BenchModerationPage.js";

const report = (over: Record<string, unknown>) => ({
  id: "r-message", status: "open", reason: "harassment", note: "please look", createdAt: "2026-11-26T01:00:00.000Z",
  reporterName: "Kim", reportedUserId: 7, reportedUserName: "Sam",
  messageId: "m1", messageBody: "the reported words", messageGone: false, channelName: "everyone", actions: [],
  ...over,
});

let lists: Record<string, unknown[]>;
let actionAnswer: { status: number; body: unknown };
let fetchMock: ReturnType<typeof vi.fn>;

const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
const listLoads = () => fetchMock.mock.calls.filter(([url]) => /\/reports\?status=/.test(url)).length;

describe("BenchModerationPage", () => {
  beforeEach(() => {
    lists = {
      open: [
        report({}),
        report({ id: "r-dm", reason: "spam", channelName: null, messageBody: "dm words", messageGone: true }),
        report({ id: "r-person", reason: "other", messageId: null, messageBody: null, channelName: null, note: null }),
      ],
      closed: [
        report({ id: "r-closed", status: "resolved", actions: [{ action: "resolve", note: "spoke to them", userName: "Mod", createdAt: "2026-11-26T02:00:00.000Z" }] }),
      ],
    };
    actionAnswer = { status: 200, body: { ok: true } };
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const status = /status=(\w+)/.exec(url)?.[1];
      if (status) return { ok: true, status: 200, json: async () => lists[status] };
      if (init?.method === "POST") return { ok: actionAnswer.status < 400, status: actionAnswer.status, json: async () => actionAnswer.body };
      return { ok: false, status: 404, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const card = async (text: string) => (await screen.findByText(text)).closest("li") as HTMLElement;

  it("lists open reports with reason, place, people and the reported words", async () => {
    render(<BenchModerationPage />);
    const first = await card("the reported words");
    expect(within(first).getByText("Harassment or bullying")).toBeInTheDocument();
    expect(within(first).getByText("#everyone")).toBeInTheDocument();
    expect(within(first).getByText("Sam")).toBeInTheDocument();
    expect(within(first).getByText(/by Kim/)).toBeInTheDocument();

    const dm = await card("dm words");
    expect(within(dm).getByText("Direct message")).toBeInTheDocument();
    expect(within(dm).getByText(/This message is gone/)).toBeInTheDocument();
    expect(within(dm).queryByRole("button", { name: /Hide message/ })).not.toBeInTheDocument();

    const person = (await screen.findByText("Something else")).closest("li") as HTMLElement;
    expect(within(person).getByText("Person")).toBeInTheDocument();
    expect(within(person).queryByRole("button", { name: /Hide message/ })).not.toBeInTheDocument();
  });

  it("hides a message after confirming, then refreshes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BenchModerationPage />);
    const first = await card("the reported words");
    const loads = listLoads();
    fireEvent.click(within(first).getByRole("button", { name: /Hide message/ }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toMatch(/\/api\/bench\/reports\/r-message\/hide$/);
    expect(JSON.parse(posts()[0][1].body)).toEqual({});
    await waitFor(() => expect(listLoads()).toBeGreaterThan(loads));
  });

  it("dismisses with an optional note", async () => {
    render(<BenchModerationPage />);
    const first = await card("the reported words");
    fireEvent.click(within(first).getByRole("button", { name: /Dismiss/ }));
    fireEvent.click(within(first).getByRole("button", { name: /Dismiss/ }));

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toMatch(/\/r-message\/dismiss$/);
    expect(JSON.parse(posts()[0][1].body)).toEqual({});
  });

  it("resolves only with a note", async () => {
    render(<BenchModerationPage />);
    const first = await card("the reported words");
    fireEvent.click(within(first).getByRole("button", { name: /Resolve/ }));
    const send = within(first).getByRole("button", { name: /Resolve/ });
    expect(send).toBeDisabled();

    fireEvent.change(within(first).getByRole("textbox"), { target: { value: "spoke to them" } });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0][0]).toMatch(/\/r-message\/resolve$/);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ note: "spoke to them" });
  });

  it("says so when someone else already closed the report, and refreshes", async () => {
    actionAnswer = { status: 409, body: { error: "Report already closed", code: "INVALID_STATE" } };
    render(<BenchModerationPage />);
    const first = await card("the reported words");
    const loads = listLoads();
    fireEvent.click(within(first).getByRole("button", { name: /Dismiss/ }));
    fireEvent.click(within(first).getByRole("button", { name: /Dismiss/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Someone already closed this report.");
    await waitFor(() => expect(listLoads()).toBeGreaterThan(loads));
  });

  it("shows what was done on closed reports", async () => {
    render(<BenchModerationPage />);
    await screen.findByText("the reported words");
    fireEvent.click(screen.getByRole("tab", { name: "Closed" }));

    const closed = (await screen.findByText(/resolved ·/)).closest("li") as HTMLElement;
    expect(within(closed).getByText("Mod")).toBeInTheDocument();
    expect(within(closed).getByText('"spoke to them"')).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });
});
