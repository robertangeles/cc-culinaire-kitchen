// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { ApiError } from "../src/api/client";
import { routerMock } from "../testing/mocks";
import { createInboxStore, type InboxStore } from "../src/notifications/inboxStore";
import { createOutbox, type OutboxEntry, type OutboxStore } from "../src/outbox/outbox";
import { notificationHandlers } from "../src/notifications/notificationCommands";
import { COLUMN_WIDTH } from "../src/ui/Screen";

// The inbox and the notification settings: the real screens and the real inbox store and queue; only the server calls and push are faked.
const mocks = vi.hoisted(() => ({
  state: { current: { state: { phase: "signedOut" } as unknown, busy: false } },
  status: { current: "off" },
  push: { enable: vi.fn(), disable: vi.fn(), openSettings: vi.fn() },
  notificationsApi: { preferences: vi.fn(), savePreferences: vi.fn() },
  inbox: { current: null as unknown as InboxStore },
}));
vi.mock("../src/runtime/appContext", () => ({
  push: mocks.push,
  notificationsApi: mocks.notificationsApi,
  useSession: () => mocks.state.current,
  usePushStatus: () => mocks.status.current,
}));
vi.mock("../src/runtime/notifications", () => ({
  get inbox() {
    return mocks.inbox.current;
  },
  useInbox: () => useSyncExternalStore(mocks.inbox.current.subscribe, mocks.inbox.current.getSnapshot),
}));

import Inbox from "../app/(app)/(inbox)/index";
import NotificationSettings from "../app/notification-settings";

const PO = "11111111-1111-4111-8111-111111111111";
const chef = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["purchasing:receive"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const row = (id: string, type: string, payload: Record<string, unknown> = {}) => ({ notificationId: id, type, payload, relatedEntityType: "purchase_order", relatedEntityId: PO, createdAt: new Date(Date.now() - 5 * 60_000).toISOString() });

let server: { rows: ReturnType<typeof row>[]; count: number; down: boolean };
let markRead: ReturnType<typeof vi.fn>;
let outbox: ReturnType<typeof createOutbox>;

beforeEach(() => {
  mocks.state.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false };
  mocks.status.current = "off";
  server = { rows: [row("n1", "PO_REJECTED", { poNumber: "PO-12", reason: "Over budget" }), row("n2", "DELIVERY_OVERDUE", { poNumber: "PO-9" }), row("n3", "SHIFT_ASSIGNED", { body: "A shift was assigned to you." })], count: 3, down: false };
  markRead = vi.fn(async () => {});
  const entries = new Map<string, OutboxEntry>();
  const store: OutboxStore = { list: async () => [...entries.values()], put: async (e) => void entries.set(e.id, { ...e }), remove: async (ids) => ids.forEach((i) => entries.delete(i)) };
  let n = 0;
  outbox = createOutbox({ store, send: async () => {}, handlers: notificationHandlers({ markRead }), now: () => ++n, newId: () => `e${n}`, getUserId: () => 1 });
  const kv = new Map<string, string>();
  mocks.inbox.current = createInboxStore({
    api: {
      list: async () => (server.down ? Promise.reject(new ApiError("network")) : server.rows),
      unreadCount: async () => (server.down ? Promise.reject(new ApiError("network")) : server.count),
    },
    kv: { get: async (k) => kv.get(k) ?? null, set: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) },
    outbox,
    getUserId: () => 1,
    kick: () => void outbox.drain(),
  });
  routerMock.push.mockClear();
  (routerMock as unknown as { navigate: ReturnType<typeof vi.fn> }).navigate = vi.fn();
});
afterEach(cleanup);

describe("the inbox", () => {
  it("lists each unread notification with words for its type, and the count", async () => {
    render(<Inbox />);
    expect(await screen.findByText("Order PO-12 was not approved: Over budget")).toBeTruthy();
    expect(screen.getByText("Order not approved")).toBeTruthy();
    expect(screen.getByText("New shift")).toBeTruthy();
    expect(screen.getByText("A shift was assigned to you.")).toBeTruthy();
    expect(screen.getByText("3 unread")).toBeTruthy();
    expect(screen.getAllByText("5 min ago")).toHaveLength(3);
  });

  it("marks one read: it leaves the list at once and the server is told", async () => {
    render(<Inbox />);
    await screen.findByText("Order PO-12 was not approved: Over budget");
    fireEvent.click(screen.getAllByRole("button", { name: "Mark read" })[0]);
    await waitFor(() => expect(screen.queryByText("Order PO-12 was not approved: Over budget")).toBeNull());
    expect(screen.getByText("2 unread")).toBeTruthy();
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("n1"));
  });

  it("opens the screen a notification is about where the phone has one (an overdue delivery: the Receive list)", async () => {
    render(<Inbox />);
    await screen.findByText("The delivery for order PO-9 is overdue.");
    const open = screen.getAllByRole("button", { name: "Open" });
    expect(open).toHaveLength(1); // only the overdue delivery has a phone screen
    fireEvent.click(open[0]);
    expect((routerMock as unknown as { navigate: ReturnType<typeof vi.fn> }).navigate).toHaveBeenCalledWith("/(app)/(receive)");
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("n2"));
  });

  it("says when there is nothing new", async () => {
    server.rows = [];
    server.count = 0;
    render(<Inbox />);
    expect(await screen.findByText("You're all caught up")).toBeTruthy();
  });

  it("shows the last copy with no signal, and says so", async () => {
    await mocks.inbox.current.refresh();
    server.down = true;
    render(<Inbox />);
    expect(await screen.findByText("No signal. Showing what was here last time.")).toBeTruthy();
    expect(screen.getByText("Order PO-12 was not approved: Over budget")).toBeTruthy();
  });

  it("fails plainly with Try again when there is no signal and nothing saved", async () => {
    server.down = true;
    render(<Inbox />);
    expect(await screen.findByText(/Couldn't load your notifications/)).toBeTruthy();
    server.down = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("3 unread")).toBeTruthy();
  });

  it("offers push here (not at launch): Turn on asks the phone", async () => {
    render(<Inbox />);
    expect(screen.getByText("Get a push when something needs you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(mocks.push.enable).toHaveBeenCalled();
  });

  it("sends someone who refused to the phone's settings, and says nothing once push is on", async () => {
    mocks.status.current = "blocked";
    const { unmount } = render(<Inbox />);
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(mocks.push.openSettings).toHaveBeenCalled();
    unmount();
    mocks.status.current = "on";
    render(<Inbox />);
    expect(screen.queryByText("Get a push when something needs you")).toBeNull();
  });

  it("links to the notification settings", async () => {
    render(<Inbox />);
    fireEvent.click(screen.getByRole("button", { name: "Notification settings" }));
    expect(routerMock.push).toHaveBeenCalledWith("/notification-settings");
  });

  it("sits in the 560 dp column on a tablet", async () => {
    const { container } = render(<Inbox />);
    await screen.findByText("3 unread");
    const column = [...container.querySelectorAll<HTMLElement>("div")].find((d) => parseFloat(getComputedStyle(d).maxWidth) === COLUMN_WIDTH);
    expect(column).toBeTruthy();
  });
});

const prefs = (over: object = {}) => ({
  types: [
    { type: "SHIFT_ASSIGNED", label: "New shifts", enabled: true },
    { type: "ROSTER_PUBLISHED", label: "Roster published", enabled: false },
  ],
  quietHours: null,
  ...over,
});

describe("notification settings", () => {
  beforeEach(() => {
    mocks.notificationsApi.preferences.mockReset().mockResolvedValue(prefs());
    mocks.notificationsApi.savePreferences.mockReset().mockImplementation(async (u: { disabledTypes?: string[]; quietHours?: unknown }) =>
      prefs({ ...(u.disabledTypes && { types: prefs().types.map((t) => ({ ...t, enabled: !u.disabledTypes!.includes(t.type) })) }), ...(u.quietHours !== undefined && { quietHours: u.quietHours }) }),
    );
  });

  it("lists each kind with the server's label and switches one off (the whole list of switched-off kinds is sent)", async () => {
    render(<NotificationSettings />);
    const shifts = await screen.findByLabelText("New shifts");
    fireEvent.click(shifts);
    await waitFor(() => expect(mocks.notificationsApi.savePreferences).toHaveBeenCalledWith({ disabledTypes: ["ROSTER_PUBLISHED", "SHIFT_ASSIGNED"] }));
  });

  it("sets quiet hours in the phone's own time zone, and refuses a time that is not HH:MM", async () => {
    render(<NotificationSettings />);
    await screen.findByLabelText("New shifts");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "25:00" } });
    expect(screen.getByText(/Use 24-hour times/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "21:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Set quiet hours" }));
    await waitFor(() => expect(mocks.notificationsApi.savePreferences).toHaveBeenCalledWith({ quietHours: { start: "21:30", end: "07:00", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } }));
    expect(await screen.findByText("Quiet hours saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off quiet hours" }));
    await waitFor(() => expect(mocks.notificationsApi.savePreferences).toHaveBeenLastCalledWith({ quietHours: null }));
  });

  it("says plainly when this build cannot receive pushes, and turns push off on this phone when it is on", async () => {
    mocks.status.current = "unavailable";
    const { unmount } = render(<NotificationSettings />);
    expect(await screen.findByText(/can't receive pushes yet/)).toBeTruthy();
    unmount();
    mocks.status.current = "on";
    render(<NotificationSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn off on this phone" }));
    expect(mocks.push.disable).toHaveBeenCalled();
  });

  it("shows a refused save in plain words and keeps the switch as it was", async () => {
    mocks.notificationsApi.savePreferences.mockRejectedValueOnce(new ApiError("network"));
    render(<NotificationSettings />);
    fireEvent.click(await screen.findByLabelText("New shifts"));
    expect(await screen.findByText("Couldn't save. Check your signal and try again.")).toBeTruthy();
  });

  it("says when the settings cannot be loaded", async () => {
    mocks.notificationsApi.preferences.mockRejectedValueOnce(new ApiError("network"));
    render(<NotificationSettings />);
    expect(await screen.findByText(/Couldn't load your notification settings/)).toBeTruthy();
  });
});
