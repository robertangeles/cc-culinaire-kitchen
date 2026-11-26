// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { Alert, AppState, BackHandler, Keyboard, TextInput } from "react-native";
import { createAppLock, GRACE_MS, RECENT_MS, type AuthResult } from "../src/lock/appLock";
import { lockAlerts } from "../src/lock/alerts";
import { LockProvider, useAppLock } from "../src/lock/LockProvider";
import { COLUMN_WIDTH } from "../src/ui/Screen";
import { Text } from "../src/ui/Text";
import { Button } from "../src/ui/Button";
import { admin, person } from "./ordersHarness";

vi.mock("../src/runtime/appContext", () => ({ useSession: () => ({}), client: {} }));
vi.mock("../src/storage/kv", () => ({ sqliteKv: {} }));

const approver = person(["purchasing:approve"]);
const cook = person(["waste:log"]);
const clock = { now: 1_000_000 };
const authenticate = vi.fn<(reason: string) => Promise<AuthResult>>();
const onSignOut = vi.fn();
const acted = vi.fn();
const mounts = { count: 0 };
let appState: (s: string) => void = () => {};
let back: () => boolean | null | undefined = () => false;

/** A screen of the app: something to read, a field half typed, and a guarded action. */
function Orders() {
  const { confirm } = useAppLock();
  useEffect(() => {
    mounts.count++;
  }, []);
  return (
    <>
      <Text>PO-100, Fresh Farms, $35.00</Text>
      <TextInput accessibilityLabel="Reason" />
      <Button label="Approve" onPress={() => void confirm("Approve PO-100").then((ok) => acted(ok))} />
    </>
  );
}

function open(user: Parameters<typeof LockProvider>[0]["user"] = approver) {
  const lock = createAppLock({ authenticate, now: () => clock.now, uptime: () => clock.now });
  const tree = (u: typeof user) => (
    <LockProvider lock={lock} user={u} onSignOut={onSignOut}>
      <Orders />
    </LockProvider>
  );
  const view = render(tree(user));
  return { lock, setUser: (u: typeof user) => view.rerender(tree(u)) };
}

const unlock = () => screen.queryByRole("button", { name: "Unlock" });
const seen = () => screen.queryByRole("button", { name: "Approve" });
async function unlocked() {
  fireEvent.click(unlock()!);
  await waitFor(() => expect(unlock()).toBeNull());
}
const away = (ms: number) => {
  act(() => appState("background"));
  clock.now += ms;
  act(() => appState("active"));
};

beforeEach(() => {
  clock.now = 1_000_000;
  mounts.count = 0;
  authenticate.mockReset().mockResolvedValue("ok");
  vi.spyOn(AppState, "addEventListener").mockImplementation((_e, listener) => {
    appState = listener as (s: string) => void;
    return { remove: () => {} } as ReturnType<typeof AppState.addEventListener>;
  });
  vi.spyOn(BackHandler, "addEventListener").mockImplementation((_e, listener) => {
    back = listener as typeof back;
    return { remove: () => void (back = () => false) };
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the lock screen", () => {
  it.each([["an approver", approver], ["an Administrator", admin], ["someone who sees only their own shifts and documents", person(["roster:read-own", "compliance:read-own"])]])("is what %s meets on a cold start, in the app's look, with nothing readable behind it", (_who, user) => {
    open(user);
    expect(screen.getByRole("heading", { name: "Locked" })).toBeTruthy();
    expect(screen.getByText("App lock")).toBeTruthy();
    expect(unlock()).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(seen()).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Reason" })).toBeNull();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("is never there for someone without the permissions, nor is the cover when they switch apps", () => {
    open(cook);
    expect(unlock()).toBeNull();
    expect(seen()).toBeTruthy();
    act(() => appState("background"));
    expect(seen()).toBeTruthy();
    clock.now += GRACE_MS * 10;
    act(() => appState("active"));
    expect(unlock()).toBeNull();
    expect(seen()).toBeTruthy();
  });

  it("is never there with nobody signed in", () => {
    open(null);
    expect(unlock()).toBeNull();
  });

  it("opens the app where it was, with what was typed still there", async () => {
    open();
    await unlocked();
    fireEvent.change(screen.getByRole("textbox", { name: "Reason" }), { target: { value: "Too much flour" } });
    const dismissed = vi.spyOn(Keyboard, "dismiss");
    away(GRACE_MS + 1);
    expect(dismissed).toHaveBeenCalled();
    expect(seen()).toBeNull();
    await unlocked();
    expect((screen.getByRole("textbox", { name: "Reason" }) as HTMLInputElement).value).toBe("Too much flour");
    expect(mounts.count).toBe(1);
  });

  it("comes back only after more than the grace period away", async () => {
    open();
    await unlocked();
    away(GRACE_MS);
    expect(unlock()).toBeNull();
    away(GRACE_MS + 1);
    expect(unlock()).toBeTruthy();
  });

  it("covers the screen while the app is not in front", async () => {
    open();
    await unlocked();
    act(() => appState("inactive"));
    expect(seen()).toBeNull();
    expect(unlock()).toBeNull();
    act(() => appState("active"));
    expect(seen()).toBeTruthy();
  });

  it("stays when the prompt is cancelled, without a word, and never signs out", async () => {
    authenticate.mockResolvedValue("cancelled");
    open();
    fireEvent.click(unlock()!);
    await waitFor(() => expect(authenticate).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Unlock" })).toBeTruthy();
    expect(seen()).toBeNull();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("stays after five failed tries, says so, and never signs out", async () => {
    authenticate.mockResolvedValue("failed");
    open();
    for (let i = 1; i <= 5; i++) {
      fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));
      await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(i));
      expect(await screen.findByText("That didn't work. Try again.")).toBeTruthy();
    }
    expect(seen()).toBeNull();
    expect(onSignOut).not.toHaveBeenCalled();
    authenticate.mockResolvedValue("lockout");
    fireEvent.click(await screen.findByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Too many tries. Wait a minute, then unlock with this device's passcode.")).toBeTruthy();
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("on a device with no biometrics and no passcode says to set one up or sign out, and opens once there is one", async () => {
    authenticate.mockResolvedValue("unprotected");
    open();
    fireEvent.click(unlock()!);
    expect(await screen.findByRole("heading", { name: "Set up a screen lock" })).toBeTruthy();
    expect(screen.getByText(/sign out/)).toBeTruthy();
    expect(seen()).toBeNull();
    authenticate.mockResolvedValue("ok");
    await unlocked();
    expect(seen()).toBeTruthy();
  });

  it("signs out only when asked", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("is on again for the next sign-in", async () => {
    const { setUser } = open();
    await unlocked();
    setUser(null);
    setUser(approver);
    expect(unlock()).toBeTruthy();
  });

  it("takes Android's Back, so it cannot move the screens behind it", async () => {
    open();
    expect(back()).toBe(true);
    await unlocked();
    expect(back()).toBe(false);
  });

  it("keeps to the column on an iPad", () => {
    open();
    let el: HTMLElement | null = screen.getByRole("heading", { name: "Locked" });
    while (el && getComputedStyle(el).maxWidth !== `${COLUMN_WIDTH}px`) el = el.parentElement;
    expect(el).toBeTruthy();
  });
});

describe("a guarded action", () => {
  it("goes ahead after a recent unlock, asks after a while, and locks the app when the prompt is cancelled", async () => {
    open();
    await unlocked();
    fireEvent.click(seen()!);
    await waitFor(() => expect(acted).toHaveBeenLastCalledWith(true));
    expect(authenticate).toHaveBeenCalledTimes(1);

    clock.now += RECENT_MS + 1;
    authenticate.mockResolvedValue("cancelled");
    fireEvent.click(seen()!);
    await waitFor(() => expect(acted).toHaveBeenLastCalledWith(false));
    expect(authenticate).toHaveBeenLastCalledWith("Approve PO-100");
    expect(unlock()).toBeTruthy();
  });

  it("asks nothing of someone without the lock", async () => {
    open(cook);
    fireEvent.click(seen()!);
    await waitFor(() => expect(acted).toHaveBeenLastCalledWith(true));
    expect(authenticate).not.toHaveBeenCalled();
  });
});

describe("a native question left open when the app locked", () => {
  it("does nothing until the app is unlocked", () => {
    let locked = true;
    let press: (() => void) | undefined;
    const shown = vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => void (press = buttons?.[1].onPress as () => void));
    const remove = vi.fn();
    lockAlerts(() => locked);
    Alert.alert("Delete this?", "It is removed.", [{ text: "Keep it", style: "cancel" }, { text: "Delete", onPress: remove }]);
    expect(shown).toHaveBeenCalled();
    press!();
    expect(remove).not.toHaveBeenCalled();
    locked = false;
    press!();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
