// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { Alert } from "react-native";
import type { BenchMessage } from "@culinaire/shared/schemas/bench";
import { ApiError } from "../src/api/client";
import type { BenchApi, Room } from "../src/bench/benchApi";
import type { LiveSocket } from "../src/bench/benchLive";
import { BenchProvider } from "../src/bench/BenchProvider";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { client: {}, useSession: () => sessionState.current };
});
vi.mock("../src/bench/nativeLive", () => ({ nativeSocket: () => null }));

import Bench from "../app/(app)/(bench)/index";
import BenchRoom from "../app/(app)/(bench)/bench-room";

const main = { storeLocationId: "L1", organisationId: 5, locationName: "Main Kitchen", classification: "branch" };
const msg = (n: number, over: Partial<BenchMessage> = {}): BenchMessage => ({ messageId: `m${n}`, channelId: 2, dmThreadId: null, userId: 8, userName: "Bo Li", userPhotoPath: null, messageBody: `Message ${n}`, messageType: "text", recipeTitle: null, editedInd: false, createdDttm: new Date(Date.UTC(2026, 10, 20, 1, n)).toISOString(), reactions: [], ...over });

let api: { [K in keyof BenchApi]: ReturnType<typeof vi.fn> };
let rows: BenchMessage[];
let handlers: Map<string, ((p: unknown) => void)[]>;
let sent: [string, unknown][];
let socket: LiveSocket;
const arrive = (event: string, payload?: unknown) => act(async () => handlers.get(event)?.forEach((h) => h(payload)));
const settle = (ms = 0) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const connect = async () => {
  socket.connected = true;
  await arrive("connect");
  await settle();
};
const signedIn = (roles: string[] = []) => (sessionState.current = { state: { phase: "ready", user: { userId: 7, userName: "Ana", userEmail: "a@x.test", mfaEnabled: false, roles, permissions: [] }, location: main, locations: [main] }, busy: false });
const show = async (node: React.ReactNode) => {
  const view = render(<BenchProvider userId={7} api={api as unknown as BenchApi} socket={socket}>{node}</BenchProvider>);
  await settle();
  return view;
};
const room = async (params: Record<string, string> = { channel: "org_5" }) => {
  searchParams.current = params;
  const view = await show(<BenchRoom />);
  await connect();
  return view;
};
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const write = (text: string) => fireEvent.change(screen.getByLabelText("Your message"), { target: { value: text } });
const wide = (on: boolean) => {
  // What react-native-web measures the window by; jsdom lays nothing out.
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: on ? 820 : 390 });
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: on ? 1180 : 844 });
  window.dispatchEvent(new Event("resize"));
};

beforeEach(() => {
  wide(false);
  signedIn();
  rows = [msg(1), msg(2, { userId: 7, userName: "Ana" })];
  handlers = new Map();
  sent = [];
  socket = { connected: false, active: true, on: (e, h) => void handlers.set(e, [...(handlers.get(e) ?? []), h as (p: unknown) => void]), connect: vi.fn(), disconnect: vi.fn(() => void (socket.connected = false)), volatile: { emit: (e, p) => void sent.push([e, p]) } };
  api = {
    whole: vi.fn((p) => p),
    channels: vi.fn(async () => [
      { channelId: 1, channelKey: "everyone", channelName: "Everyone", channelType: "global", channelBanner: null },
      { channelId: 2, channelKey: "org_5", channelName: "Main Kitchen", channelType: "organisation", channelBanner: null },
    ]),
    threads: vi.fn(async () => [{ dmThreadId: 3, otherUserId: 9, otherUserName: "Cy", otherUserPhotoPath: null, lastMessage: "See you at six", lastMessageAt: new Date().toISOString() }]),
    openThread: vi.fn(async (id: number) => ({ dmThreadId: 4, otherUserId: id, otherUserName: "Bo Li", otherUserPhotoPath: null, lastMessage: null, lastMessageAt: "" })),
    messages: vi.fn(async (_r: Room) => rows),
    pins: vi.fn(async () => []),
    pin: vi.fn(async () => {}),
    unpin: vi.fn(async () => {}),
    search: vi.fn(async () => []),
  };
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Bench's list", () => {
  it("lists the channels and the direct messages and opens one as a screen of its own on a phone", async () => {
    await show(<Bench />);
    expect(screen.getByText("Main Kitchen")).toBeTruthy();
    expect(screen.getByText("See you at six")).toBeTruthy();
    press("Main Kitchen");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/bench-room", params: { channel: "org_5" } });
    press("Cy");
    expect(routerMock.push).toHaveBeenLastCalledWith({ pathname: "/bench-room", params: { thread: "3" } });
  });

  it("marks a thread whose message came while it was not open", async () => {
    await show(<Bench />);
    await arrive("bench:dm:new", msg(9, { channelId: null, dmThreadId: 3, userId: 9, userName: "Cy", messageBody: "Running late" }));
    expect(screen.getByRole("button", { name: "Cy, new message" })).toBeTruthy();
    expect(screen.getByText("Running late")).toBeTruthy();
  });

  it("with no direct messages says how to start one; with no signal offers to try again", async () => {
    api.threads.mockResolvedValue([]);
    await show(<Bench />);
    expect(screen.getByText("No direct messages yet")).toBeTruthy();
    cleanup();
    api.channels.mockRejectedValueOnce(new ApiError("network"));
    await show(<Bench />);
    expect(screen.getByText("Can't reach the server. Check your signal and try again.")).toBeTruthy();
    press("Try again");
    await waitFor(() => expect(screen.getByText("Main Kitchen")).toBeTruthy());
  });

  it("connects when it is shown and disconnects when it goes away", async () => {
    const { unmount } = await show(<Bench />);
    expect(socket.connect).toHaveBeenCalled();
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it("keeps the open room beside the list at iPad width", async () => {
    wide(true);
    await show(<Bench />);
    expect(screen.getByText("Choose a conversation")).toBeTruthy();
    press("Main Kitchen");
    await waitFor(() => expect(screen.getByText("Message 1")).toBeTruthy());
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.getByText("See you at six")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to the Bench" })).toBeNull();
  });
});

describe("a kitchen's channel", () => {
  it("shows who wrote what under its day, joins the live room and says who is on the pass", async () => {
    await room();
    expect(screen.getByText("Message 1")).toBeTruthy();
    expect(sent).toContainEqual(["bench:join", { channelKey: "org_5" }]);
    await arrive("bench:presence:update", { channelKey: "org_5", users: [{ userId: 8, userName: "Bo Li", userPhotoPath: null }, { userId: 7, userName: "Ana", userPhotoPath: null }] });
    press("2 on the pass");
    expect(screen.getByText("Ana (you)")).toBeTruthy();
    press("Message Bo Li");
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith({ pathname: "/bench-room", params: { thread: "4" } }));
    expect(api.openThread).toHaveBeenCalledWith(8);
  });

  it("posts, shows it as sending, then as sent", async () => {
    await room();
    write("  Fish is in  ");
    press("Send");
    expect(sent).toContainEqual(["bench:message", { channelKey: "org_5", body: "Fish is in", messageId: expect.any(String) }]);
    const { messageId } = sent.find(([e]) => e === "bench:message")![1] as { messageId: string };
    expect(screen.getByText("Sending…")).toBeTruthy();
    expect((screen.getByLabelText("Your message") as HTMLInputElement).value).toBe("");
    await arrive("bench:message:new", msg(3, { messageId, userId: 7, userName: "Ana", messageBody: "Fish is in" }));
    expect(screen.queryByText("Sending…")).toBeNull();
    expect(screen.getByText("Fish is in")).toBeTruthy();
  });

  it("without a connection says nothing is sent, and offers to try again only when it is back", async () => {
    await room();
    socket.connected = false;
    await arrive("disconnect");
    expect(screen.getByRole("alert").textContent).toMatch(/^Not connected/);
    write("Fish is in");
    press("Send");
    expect(screen.getByText("Not sent.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" }).getAttribute("aria-disabled")).toBe("true");
    await connect();
    expect(sent.filter(([e]) => e === "bench:message")).toEqual([]);
    press("Try again");
    await waitFor(() => expect(sent).toContainEqual(["bench:message", { channelKey: "org_5", body: "Fish is in", messageId: expect.any(String) }]));
  });

  it("shows who is writing, and tells the others when this person is", async () => {
    await room();
    await arrive("bench:typing", { channelKey: "org_5", userId: 8, userName: "Bo Li" });
    expect(screen.getByText("Bo Li is writing…")).toBeTruthy();
    write("F");
    expect(sent).toContainEqual(["bench:typing", { channelKey: "org_5" }]);
  });

  it("offers the people of the room after an @ and writes the name in", async () => {
    await room();
    write("Ask @b");
    press("Mention Bo Li");
    expect((screen.getByLabelText("Your message") as HTMLInputElement).value).toBe("Ask @Bo Li ");
  });

  it("reacts, and takes one's own reaction away again", async () => {
    await room();
    press(/^Bo Li, .*Message 1$/);
    press("React Fire");
    expect(sent).toContainEqual(["bench:reaction:add", { messageId: "m1", emoji: "fire" }]);
    await arrive("bench:reaction:updated", { messageId: "m1", reactions: [{ emoji: "fire", count: 1, userIds: [7] }] });
    press("Fire, 1, yours");
    expect(sent).toContainEqual(["bench:reaction:remove", { messageId: "m1", emoji: "fire" }]);
  });

  it("edits and deletes one's own message only", async () => {
    await room();
    press(/^Bo Li, .*Message 1$/);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    press(/^Ana, .*Message 2$/);
    press("Edit");
    fireEvent.change(screen.getByLabelText("Edit your message"), { target: { value: "Better words" } });
    press("Save");
    expect(sent).toContainEqual(["bench:message:edit", { messageId: "m2", newBody: "Better words" }]);
    press(/^Ana, .*Message 2$/);
    const alert = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === "Delete")?.onPress?.());
    press("Delete");
    expect(alert).toHaveBeenCalled();
    expect(sent).toContainEqual(["bench:message:delete", { messageId: "m2" }]);
  });

  it("an Administrator may delete anyone's", async () => {
    signedIn(["Administrator"]);
    await room();
    press(/^Bo Li, .*Message 1$/);
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("pins a message and lists what is pinned", async () => {
    await room();
    api.pins.mockResolvedValue([{ messageId: "m1", messageBody: "Message 1", userName: "Bo Li" }]);
    press(/^Bo Li, .*Message 1$/);
    press("Pin");
    await waitFor(() => expect(api.pin).toHaveBeenCalledWith("org_5", "m1"));
    press("Pinned");
    await waitFor(() => expect(screen.getByRole("button", { name: "Unpin Bo Li's message" })).toBeTruthy());
    api.pins.mockResolvedValue([]);
    press("Unpin Bo Li's message");
    await waitFor(() => expect(screen.getByText("Nothing is pinned here.")).toBeTruthy());
    expect(api.unpin).toHaveBeenCalledWith("m1");
  });

  it("searches the channel on the server once typing pauses", async () => {
    await room();
    write("Half a thought");
    press("Search");
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull(); // the composer makes room for the results
    api.search.mockResolvedValue([{ messageId: "m1", messageBody: "The turbot is in", userName: "Bo Li", createdDttm: msg(1).createdDttm }]);
    fireEvent.change(screen.getByLabelText("Search this channel"), { target: { value: "turbot" } });
    expect(api.search).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("The turbot is in")).toBeTruthy());
    expect(api.search).toHaveBeenCalledWith("org_5", "turbot");
    press("Search");
    expect((screen.getByLabelText("Your message") as HTMLInputElement).value).toBe("Half a thought");
  });

  it("someone removed from the kitchen keeps nothing on screen and has nowhere to write", async () => {
    await room();
    await arrive("bench:error", { code: "FORBIDDEN", error: "x" });
    expect(screen.getByText("You don't have access to this channel any more.")).toBeTruthy();
    expect(screen.queryByText("Message 1")).toBeNull();
    expect(screen.queryByLabelText("Your message")).toBeNull();
  });

  it("an empty room invites the first message", async () => {
    rows = [];
    await room();
    expect(screen.getByText("Start the conversation")).toBeTruthy();
  });
});

describe("Everyone", () => {
  beforeEach(() => {
    rows = [msg(1, { channelId: 1 })];
  });

  it("shows no list of who is online and offers no direct message to a stranger", async () => {
    await room({ channel: "everyone" });
    await arrive("bench:presence:update", { channelKey: "everyone", users: [{ userId: 8, userName: "Bo Li", userPhotoPath: null }] });
    expect(screen.queryByText(/on the pass/)).toBeNull();
    press(/^Bo Li, .*Message 1$/);
    expect(screen.queryByRole("button", { name: "Message Bo Li" })).toBeNull();
    expect(screen.getByRole("button", { name: "Pin" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "React Fire" })).toBeTruthy();
  });
});

describe("direct messages", () => {
  it("writes to the other person, without reactions, pins or search (as the web)", async () => {
    rows = [msg(1, { channelId: null, dmThreadId: 3, userId: 9, userName: "Cy" })];
    await room({ thread: "3" });
    expect(screen.getAllByText("Cy").length).toBeGreaterThan(0);
    write("On my way");
    press("Send");
    expect(sent).toContainEqual(["bench:dm:send", { recipientId: 9, body: "On my way", messageId: expect.any(String) }]);
    press(/^Cy, .*Message 1$/);
    expect(screen.queryByRole("button", { name: "React Fire" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
});
