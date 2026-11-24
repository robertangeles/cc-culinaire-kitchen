import { describe, it, expect, vi, beforeEach } from "vitest";

// Coming back from the phone's Settings must re-read the push permission: "Turn on" sends someone there when push is refused, and the
// status stays "blocked" until the app asks again. Only the native edges (AppState, router, the app's singletons) are faked.
const mocks = vi.hoisted(() => ({
  userId: { current: 7 as number | null },
  appState: { listener: null as null | ((s: string) => void), current: "active" },
  push: { sync: vi.fn(async () => {}) },
  inbox: { refresh: vi.fn(async () => {}), markRead: vi.fn() },
}));
vi.mock("react-native", () => ({
  AppState: {
    get currentState() {
      return mocks.appState.current;
    },
    addEventListener: (_: string, l: (s: string) => void) => void (mocks.appState.listener = l),
  },
}));
vi.mock("expo-router", () => ({ router: { navigate: vi.fn() } }));
vi.mock("../storage/kv", () => ({ sqliteKv: {} }));
vi.mock("../notifications/inboxStore", () => ({ createInboxStore: () => mocks.inbox }));
vi.mock("../notifications/nativePush", () => ({ listenForPushes: vi.fn() }));
vi.mock("./appContext", () => ({
  notificationsApi: {},
  push: mocks.push,
  session: { subscribe: vi.fn(), getSnapshot: () => ({ state: { phase: "ready" } }) },
}));
vi.mock("./appOutbox", () => ({ currentUserId: () => mocks.userId.current, outbox: {}, runner: { kick: vi.fn() } }));

import { startNotifications } from "./notifications";

beforeEach(() => {
  startNotifications();
  mocks.push.sync.mockClear();
  mocks.inbox.refresh.mockClear();
  mocks.userId.current = 7;
});

describe("returning to the app", () => {
  it("re-reads the push permission and the inbox for a signed-in person", () => {
    mocks.appState.listener!("active");
    expect(mocks.push.sync).toHaveBeenCalledTimes(1);
    expect(mocks.inbox.refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the app goes to the background", () => {
    mocks.appState.listener!("background");
    expect(mocks.push.sync).not.toHaveBeenCalled();
    expect(mocks.inbox.refresh).not.toHaveBeenCalled();
  });

  it("does nothing for someone who is signed out", () => {
    mocks.userId.current = null;
    mocks.appState.listener!("active");
    expect(mocks.push.sync).not.toHaveBeenCalled();
    expect(mocks.inbox.refresh).not.toHaveBeenCalled();
  });
});
