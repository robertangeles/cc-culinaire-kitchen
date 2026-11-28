import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { socket } = vi.hoisted(() => ({
  socket: { connected: true, emit: () => undefined, on: () => undefined, off: () => undefined },
}));
vi.mock("../context/BenchSocketContext.js", () => ({
  BenchSocketProvider: ({ children }: { children: React.ReactNode }) => children,
  useBenchSocket: () => ({ socket, connected: true }),
}));
vi.mock("../context/AuthContext.js", () => ({
  useAuth: () => ({ user: { userId: 1, userName: "Me", roles: [], permissions: [] }, isGuest: false }),
}));

import { BenchPage } from "./BenchPage.js";

const sam = { userId: 7, userName: "Sam", userPhotoPath: null };
const kim = { userId: 8, userName: "Kim", userPhotoPath: null };
const message = (id: string, who: typeof sam, body: string) => ({
  messageId: id, channelId: 1, userId: who.userId, userName: who.userName, userPhotoPath: null,
  messageBody: body, messageType: "text", recipeId: null, editedInd: false, deletedInd: false,
  createdDttm: "2026-11-26T01:00:00.000Z", reactions: [],
});
const thread = (id: number, who: typeof sam) => ({
  dmThreadId: id, otherUserId: who.userId, otherUserName: who.userName, otherUserPhotoPath: null,
  lastMessage: `hello from ${who.userName}`, lastMessageAt: "2026-11-26T01:00:00.000Z",
});

let blocked: (typeof sam)[];
let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

function calls(method: string, path: RegExp) {
  return fetchMock.mock.calls.filter(([url, init]) => path.test(url) && (init?.method ?? "GET") === method);
}

const REFUSED = "You can message people in your kitchen, and people you already have a conversation with.";

describe("BenchPage report and block", () => {
  beforeEach(() => {
    blocked = [];
    Element.prototype.scrollIntoView = vi.fn();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (/\/channels\/everyone\/messages/.test(url)) return json({ messages: [message("m1", sam, "first from Sam"), message("m2", kim, "first from Kim")] });
      if (/\/api\/bench\/blocks$/.test(url)) return method === "GET" ? json(blocked) : json({ ok: true });
      if (/\/api\/bench\/blocks\/\d+$/.test(url)) return json({ ok: true });
      if (/\/api\/bench\/dm\/threads$/.test(url)) {
        return method === "GET" ? json([thread(1, sam), thread(2, kim)]) : json({ error: REFUSED, code: "DM_NOT_ALLOWED" }, 403);
      }
      if (/\/api\/bench\/channels$/.test(url)) return json([]);
      return json({}, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const open = async () => {
    render(<MemoryRouter><BenchPage /></MemoryRouter>);
    await screen.findByText("first from Kim");
  };

  it("blocks after confirming, and the person's messages leave the screen at once", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Block Sam" }));

    expect(confirm).toHaveBeenCalledWith("Block Sam? You won't see their messages, and neither of you can message the other. They aren't told.");
    await waitFor(() => expect(screen.queryByText("first from Sam")).not.toBeInTheDocument());
    expect(screen.getByText("first from Kim")).toBeInTheDocument();
    const [post] = calls("POST", /\/api\/bench\/blocks$/);
    expect(JSON.parse(post[1].body)).toEqual({ userId: 7 });

    // The DM thread with them is gone too
    fireEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(screen.getByText("hello from Kim")).toBeInTheDocument();
    expect(screen.queryByText("hello from Sam")).not.toBeInTheDocument();
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Block Sam" }));
    expect(calls("POST", /\/api\/bench\/blocks$/)).toHaveLength(0);
    expect(screen.getByText("first from Sam")).toBeInTheDocument();
  });

  it("lists blocked people, and Unblock brings their messages and thread back", async () => {
    blocked = [sam];
    await open();
    await waitFor(() => expect(screen.queryByText("first from Sam")).not.toBeInTheDocument());
    const messageLoads = calls("GET", /\/channels\/everyone\/messages/).length;

    fireEvent.click(screen.getByRole("button", { name: "Blocked people" }));
    const panel = screen.getByRole("region", { name: "Blocked people" });
    fireEvent.click(within(panel).getByRole("button", { name: "Unblock Sam" }));

    await waitFor(() => expect(calls("DELETE", /\/api\/bench\/blocks\/7$/)).toHaveLength(1));
    await screen.findByText("first from Sam");
    expect(within(panel).getByText("You haven't blocked anyone.")).toBeInTheDocument();
    expect(calls("GET", /\/channels\/everyone\/messages/).length).toBeGreaterThan(messageLoads);
    expect(calls("GET", /\/api\/bench\/dm\/threads$/).length).toBeGreaterThan(1);
  });

  it("opens a person's card from their name, and reports them from it", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Sam: options" }));
    const menu = screen.getByRole("menu", { name: "Sam" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Report" }));
    expect(screen.getByRole("dialog", { name: "Report Sam" })).toBeInTheDocument();
  });

  it("says plainly when a direct message is refused", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Sam: options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Message" }));
    expect(await screen.findByText(REFUSED)).toBeInTheDocument();
  });
});
