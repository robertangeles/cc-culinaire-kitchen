// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { Alert } from "react-native";
import type { Memory } from "@culinaire/shared/schemas/brain";
import { ApiError } from "../src/api/client";
import type { BrainApi, MemoryFilter } from "../src/brain/brainApi";
import { BrainProvider } from "../src/brain/BrainProvider";
import { COLUMN_WIDTH } from "../src/ui/Screen";
import { returnToScreen, sessionState } from "../testing/mocks";

vi.mock("../src/runtime/appContext", async () => {
  const { sessionState } = await import("../testing/mocks");
  return { client: {}, useSession: () => sessionState.current };
});
const kv = vi.hoisted(() => new Map<string, string>());
vi.mock("../src/storage/kv", () => ({ sqliteKv: { get: async (k: string) => kv.get(k) ?? null, set: async (k: string, v: string) => void kv.set(k, v), delete: async (k: string) => void kv.delete(k) } }));

import YourBrain from "../app/(app)/(brain)/index";

const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const memory = (memoryId: string, over: Partial<Memory> = {}): Memory => ({ memoryId, title: `Memory ${memoryId}`, body: `All about ${memoryId}`, sourceType: "chat", scope: "user", isPinned: false, status: "ready", createdDttm: "2026-07-08T10:00:00Z", canManage: true, authorName: null, ...over });

const mine = [memory("a", { isPinned: true }), memory("b", { status: "pending" }), memory("c", { sourceType: "waste" })];
const shared = [memory("s", { scope: "org", canManage: false, authorName: "Maria", sourceType: "stock" })];

let api: { [K in keyof BrainApi]: ReturnType<typeof vi.fn> };
const signedInWith = (permissions: string[]) =>
  (sessionState.current = { state: { phase: "ready", user: { userId: 7, userName: "Rob", userEmail: "r@x.test", mfaEnabled: false, roles: [], permissions }, location: main, locations: [main] }, busy: false });
const open = async () => {
  render(<BrainProvider userId={7} api={api as unknown as BrainApi}><YourBrain /></BrainProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const expand = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** Answers the next question with the button named. */
const answer = (text: string) => vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === text)?.onPress?.());

beforeEach(() => {
  kv.clear();
  signedInWith(["brain:read", "brain:manage"]);
  api = {
    list: vi.fn(async (f: MemoryFilter) => {
      const tier = f.scope === "org" ? shared : mine;
      const found = tier.filter((m) => (!f.sourceType || m.sourceType === f.sourceType) && (!f.search.trim() || m.body.includes(f.search)));
      return { memories: found, total: found.length };
    }),
    remove: vi.fn(async () => {}),
    nudges: vi.fn(async () => false),
    setNudges: vi.fn(async (on: boolean) => on),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Your Brain", () => {
  it("lists what is private to you, with where each came from, pinned and still-learning marked", async () => {
    await open();
    expect(screen.getByText("3 memories")).toBeTruthy();
    expect(screen.getByText("Memory a")).toBeTruthy();
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByText("Learning…")).toBeTruthy();
    expect(screen.getByText(/^from the waste log · /)).toBeTruthy();
    expect(screen.queryByText("All about a")).toBeNull();
    expand(/^Memory a/);
    expect(screen.getByText("All about a")).toBeTruthy();
  });

  it("shows what the kitchen shared, with who shared it, and nothing to remove on a colleague's", async () => {
    await open();
    fireEvent.click(screen.getByRole("tab", { name: "Shared" }));
    await waitFor(() => expect(screen.getByText(/^Maria · from the stock room/)).toBeTruthy());
    expand(/^Memory s/);
    expect(screen.getByText("All about s")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it("filters by source and searches on the server once typing pauses", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Waste" }));
    await waitFor(() => expect(screen.queryByText("Memory a")).toBeNull());
    expect(screen.getByText("Memory c")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(screen.getByText("Memory a")).toBeTruthy());
    const calls = api.list.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "about" } });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "about b" } });
    expect(api.list.mock.calls.length).toBe(calls);
    await waitFor(() => expect(screen.queryByText("Memory a")).toBeNull());
    expect(screen.getByText("Memory b")).toBeTruthy();
    expect(api.list.mock.calls.length).toBe(calls + 1);
  });

  it("asks before it removes a memory, and says so when the server could not be reached", async () => {
    await open();
    expand(/^Memory b/);
    const kept = answer("Keep it");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(kept.mock.calls[0].slice(0, 2)).toEqual(["Remove “Memory b”?", "CulinAIre forgets it for good, on the web too."]);
    expect(api.remove).not.toHaveBeenCalled();
    answer("Remove");
    api.remove.mockRejectedValueOnce(new ApiError("network"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.getByText("Can't reach the server. Check your signal and try again.")).toBeTruthy());
    expect(screen.getByText("Memory b")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText("Memory b")).toBeNull());
    expect(screen.getByText("2 memories")).toBeTruthy();
  });

  it("does not offer Remove without brain:manage, the key the server's delete asks for", async () => {
    signedInWith(["brain:read"]);
    await open();
    expand(/^Memory a/);
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  it.each([
    ["nothing remembered yet", "Private to you", "Your Brain is warming up"],
    ["nothing shared", "Shared", "Your kitchen hasn't shared anything yet"],
  ])("with %s, says so in a card", async (_name, tab, heading) => {
    api.list.mockResolvedValue({ memories: [], total: 0 });
    await open();
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    await waitFor(() => expect(screen.getByText(heading)).toBeTruthy());
    expect(screen.queryByLabelText("Search")).toBeNull();
  });

  it("says no memory matches a search or a source", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "Menu" }));
    await waitFor(() => expect(screen.getByText("No memories match")).toBeTruthy());
    expect(screen.getByLabelText("Search")).toBeTruthy();
  });

  it("with no signal, shows the saved list and when it is from; with nothing saved, offers to try again", async () => {
    await open();
    cleanup();
    api.list.mockRejectedValue(new ApiError("network"));
    await open();
    expect(screen.getByRole("alert").textContent).toMatch(/^Can't reach the server\. This is the list from /);
    expect(screen.getByText("Memory a")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Shared" }));
    await waitFor(() => expect(screen.getByText("Can't reach the server. Check your signal and try again.")).toBeTruthy());
    api.list.mockResolvedValue({ memories: shared, total: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Memory s")).toBeTruthy());
  });

  it("loads the next page, and looks again on coming back to the tab", async () => {
    api.list.mockImplementation(async (_f: MemoryFilter, offset: number) => ({ memories: offset === 0 ? mine : [memory("d")], total: 4 }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Memory d")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    const calls = api.list.mock.calls.length;
    await act(async () => returnToScreen());
    expect(api.list.mock.calls.length).toBeGreaterThan(calls);
  });

  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("keeps to one centred column on %s", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    await open();
    let column = screen.getByText("3 memories") as HTMLElement | null;
    while (column && parseFloat(getComputedStyle(column).maxWidth) !== COLUMN_WIDTH) column = column.parentElement;
    expect(column).not.toBeNull();
    expect(getComputedStyle(column!).width).toBe("100%");
  });
});

describe("proactive nudges", () => {
  const nudges = () => screen.getByRole("switch", { name: "Proactive nudges" }) as HTMLInputElement;

  it("shows what the person chose and saves a change", async () => {
    await open();
    expect(nudges().checked).toBe(false);
    await act(async () => void fireEvent.click(nudges()));
    expect(api.setNudges).toHaveBeenCalledWith(true);
    expect(nudges().checked).toBe(true);
  });

  it("goes back and says so when it could not be saved", async () => {
    api.setNudges.mockRejectedValueOnce(new ApiError("network"));
    await open();
    await act(async () => void fireEvent.click(nudges()));
    expect(nudges().checked).toBe(false);
    expect(screen.getByText("Couldn't save that. Check your signal and try again.")).toBeTruthy();
  });

  it("shows no switch while the choice is not known", async () => {
    api.nudges.mockRejectedValueOnce(new ApiError("network"));
    await open();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Couldn't load this setting. Pull down to try again.")).toBeTruthy();
  });
});
