// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { Alert } from "react-native";
import type { ReactNode } from "react";
import { ApiError } from "../src/api/client";
import type { ChatApi, WireMessage } from "../src/chat/chatApi";
import type { StreamEvent } from "../src/chat/dataStream";
import { ChatProvider } from "../src/chat/ChatProvider";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { client: {}, useSession: () => sessionState.current };
});

import Conversations from "../app/(app)/(chat)/index";
import Conversation from "../app/(app)/(chat)/conversation";

const chef = { userId: 1, userName: "Rob Angeles", userEmail: "r@x.test", mfaEnabled: false, roles: [], permissions: [] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };

/** A chat API whose answers the test releases part by part. */
function fakeApi() {
  const answers: { push: (e: StreamEvent | Error | "end") => void }[] = [];
  const sent: WireMessage[][] = [];
  const api = {
    list: vi.fn(async () => [{ conversationId: "c1", conversationTitle: "Hollandaise rescue", updatedDttm: "2026-11-20T10:00:00Z" }]),
    get: vi.fn(async (id: string) => ({ conversationId: id, conversationTitle: "Hollandaise rescue", messages: [{ messageId: "m1", messageRole: "user" as const, messageBody: "It split", messageSequence: 0 }, { messageId: "m2", messageRole: "assistant" as const, messageBody: "Add **warm water**.", messageSequence: 1 }] })),
    create: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    answer: vi.fn((messages: WireMessage[], signal: AbortSignal) => {
      sent.push(messages);
      const queue: (StreamEvent | Error | "end")[] = [];
      let wake = () => {};
      answers.push({ push: (e) => { queue.push(e); wake(); } });
      return (async function* () {
        for (;;) {
          if (signal.aborted) throw new ApiError("aborted");
          const next = queue.shift();
          if (next === undefined) {
            await new Promise<void>((r) => { wake = r; signal.addEventListener("abort", () => r(), { once: true }); });
            continue;
          }
          if (next === "end") return;
          if (next instanceof Error) throw next;
          yield next;
        }
      })();
    }),
  } satisfies ChatApi;
  return { api, answers, sent };
}

let chat: ReturnType<typeof fakeApi>;
const wrap = (node: ReactNode) => <ChatProvider api={chat.api}>{node}</ChatProvider>;
const press = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
const feed = async (e: StreamEvent | Error | "end", n = 0) => act(async () => { chat.answers[n].push(e); await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  chat = fakeApi();
  sessionState.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false };
  searchParams.current = {};
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  routerMock.push.mockClear();
});

describe("conversation list", () => {
  it("lists saved conversations and opens one or a new one", async () => {
    render(wrap(<Conversations />));
    await waitFor(() => expect(screen.getByText("Hollandaise rescue")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^Hollandaise rescue/ }));
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/conversation", params: { id: "c1" } });
    press("New conversation");
    expect(routerMock.push).toHaveBeenCalledWith("/conversation");
  });

  it("deletes a conversation only after asking", async () => {
    vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === "Delete")?.onPress?.());
    render(wrap(<Conversations />));
    await waitFor(() => expect(screen.getByText("Hollandaise rescue")).toBeTruthy());
    chat.api.list.mockResolvedValueOnce([]);
    press("Delete Hollandaise rescue");
    expect(Alert.alert).toHaveBeenCalled();
    await waitFor(() => expect(chat.api.remove).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.getByText(/No saved conversations yet/)).toBeTruthy());
  });

  it("says plainly when the list cannot be read", async () => {
    chat.api.list.mockRejectedValueOnce(new ApiError("network"));
    render(wrap(<Conversations />));
    await waitFor(() => expect(screen.getByText("Can't reach the server. Check your signal and try again.")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("a conversation", () => {
  it("greets by first name with the web's suggestions, streams the answer with the grounded marker, and offers Stop while it streams", async () => {
    render(wrap(<Conversation />));
    expect(screen.getByText("Hello, Rob")).toBeTruthy();
    press("My hollandaise split. How do I fix it?");
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy());
    expect(screen.getByText("Antoine is thinking…")).toBeTruthy();
    await feed({ type: "grounded", titles: ["Sauce station notes"] });
    await feed({ type: "text", text: "Whisk in a spoon of **warm water**" });
    expect(screen.getByText("warm water")).toBeTruthy();
    press(/Grounded in your Brain/);
    expect(screen.getByText("• Sauce station notes")).toBeTruthy();
    await feed("end");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    expect(chat.api.create).toHaveBeenCalledWith(expect.any(String), "My hollandaise split. How do I fix it?");
  });

  it("sends the whole history on the next question", async () => {
    render(wrap(<Conversation />));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "First" } });
    press("Send");
    await feed({ type: "text", text: "One." });
    await feed("end");
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Second" } });
    press("Send");
    await waitFor(() => expect(chat.sent).toHaveLength(2));
    expect(chat.sent[1]).toEqual([{ role: "user", content: "First" }, { role: "assistant", content: "One." }, { role: "user", content: "Second" }]);
  });

  it("Stop keeps what arrived and says it was stopped", async () => {
    render(wrap(<Conversation />));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Long one" } });
    press("Send");
    await feed({ type: "text", text: "The first half" });
    await act(async () => press("Stop"));
    await waitFor(() => expect(screen.getByText("Stopped.")).toBeTruthy());
    expect(screen.getByText("The first half")).toBeTruthy();
  });

  it("shows a coded refusal in plain words with Try again, and retries with the same history", async () => {
    render(wrap(<Conversation />));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Hi" } });
    press("Send");
    await feed(new ApiError("rate_limited", "x", 429, undefined, "RATE_LIMITED"));
    expect(screen.getByText("You're sending messages too fast. Wait a minute, then try again.")).toBeTruthy();
    press("Try again");
    await waitFor(() => expect(chat.sent).toHaveLength(2));
    expect(chat.sent[1]).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("offers no retry when the free sessions are used up, and no upgrade link", async () => {
    render(wrap(<Conversation />));
    fireEvent.change(screen.getByLabelText("Your question"), { target: { value: "Hi" } });
    press("Send");
    await feed(new ApiError("forbidden", "x", 403, undefined, "FREE_SESSIONS_EXHAUSTED"));
    expect(screen.getByText("You've used all your free sessions.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(/upgrade|pricing|subscribe/i)).toBeNull();
  });

  it("opens a saved conversation with its answer rendered as Markdown", async () => {
    searchParams.current = { id: "c1" };
    render(wrap(<Conversation />));
    await waitFor(() => expect(screen.getByText("warm water")).toBeTruthy());
    expect(screen.getByText("It split")).toBeTruthy();
    expect(chat.api.get).toHaveBeenCalledWith("c1");
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("puts the chat screens in the app's 560 dp column, centred, on %s", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    for (const Screen of [Conversations, Conversation]) {
      const { container, unmount } = render(wrap(<Screen />));
      await waitFor(() => expect([...container.querySelectorAll("div")].some((d) => getComputedStyle(d).maxWidth === "560px")).toBe(true));
      const column = [...container.querySelectorAll("div")].find((d) => getComputedStyle(d).maxWidth === "560px")!;
      expect(getComputedStyle(column).width).toBe("100%");
      expect(getComputedStyle(column).alignSelf).toBe("center");
      unmount();
    }
  });
});
