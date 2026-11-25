import { describe, it, expect, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { createAppLock, GRACE_MS, LOCK_PERMISSIONS, lockRequired, RECENT_MS, type AuthResult } from "./appLock";

const person = (permissions: string[], roles: string[] = [], userId = 1): AuthUser => ({ userId, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles, permissions });
const approver = person(["purchasing:approve"]);
const cook = person(["waste:log", "roster:read-own", "compliance:read-own", "purchasing:credit"]);

function make(user: AuthUser | null = approver) {
  const clock = { now: 1_000_000 };
  const authenticate = vi.fn<(reason: string) => Promise<AuthResult>>(async () => "ok");
  const lock = createAppLock({ authenticate, now: () => clock.now });
  lock.setUser(user);
  return { clock, authenticate, lock };
}

describe("who the lock is for", () => {
  it.each(LOCK_PERMISSIONS)("%s holders", (key) => expect(lockRequired(person([key]))).toBe(true));

  it("Administrators, who hold every permission", () => expect(lockRequired(person([], ["Administrator"]))).toBe(true));

  it("not someone who only sees their own shifts and documents, and not a credit note alone", () => {
    expect(lockRequired(cook)).toBe(false);
    expect(lockRequired(person([]))).toBe(false);
  });
});

describe("the lock", () => {
  it("is on at a cold start and at a sign-in, and off once unlocked", async () => {
    const { lock, authenticate } = make();
    expect(lock.isLocked()).toBe(true);
    expect(await lock.unlock()).toBe(true);
    expect(lock.isLocked()).toBe(false);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("is never on for someone without the permissions, or with nobody signed in", () => {
    expect(make(cook).lock.isLocked()).toBe(false);
    expect(make(null).lock.isLocked()).toBe(false);
  });

  it("is on again after a sign-out, whoever signs in next", async () => {
    const { lock } = make();
    await lock.unlock();
    lock.setUser(null);
    lock.setUser(approver);
    expect(lock.isLocked()).toBe(true);
    await lock.unlock();
    lock.setUser(person(["purchasing:approve"], [], 2));
    expect(lock.isLocked()).toBe(true);
  });

  it("stays off when the same person is read again, and comes on when they are given the permissions", async () => {
    const { lock } = make();
    await lock.unlock();
    lock.setUser({ ...approver, userName: "New name" });
    expect(lock.isLocked()).toBe(false);

    const given = make(cook).lock;
    given.setUser(person(["purchasing:approve"]));
    expect(given.isLocked()).toBe(true);
  });

  it("comes on after more than the grace period in the background, not before", async () => {
    const { lock, clock } = make();
    await lock.unlock();
    lock.appState("background");
    clock.now += GRACE_MS;
    lock.appState("active");
    expect(lock.isLocked()).toBe(false);

    lock.appState("background");
    clock.now += GRACE_MS + 1;
    lock.appState("active");
    expect(lock.isLocked()).toBe(true);
  });

  it("counts from when the app left, however many events follow, and iOS's inactive is not leaving", async () => {
    const { lock, clock } = make();
    await lock.unlock();
    lock.appState("inactive");
    clock.now += GRACE_MS * 2;
    lock.appState("active");
    expect(lock.isLocked()).toBe(false);

    lock.appState("background");
    clock.now += GRACE_MS;
    lock.appState("background");
    clock.now += 1;
    lock.appState("inactive");
    lock.appState("active");
    expect(lock.isLocked()).toBe(true);
  });

  it("comes on when the phone's clock went backwards meanwhile", async () => {
    const { lock, clock } = make();
    await lock.unlock();
    lock.appState("background");
    clock.now -= 5_000;
    lock.appState("active");
    expect(lock.isLocked()).toBe(true);
  });

  it("covers the screen from the moment the app is not in front until it is back", async () => {
    const { lock } = make();
    await lock.unlock();
    expect(lock.getSnapshot().covered).toBe(false);
    lock.appState("inactive");
    expect(lock.getSnapshot().covered).toBe(true);
    lock.appState("background");
    expect(lock.getSnapshot().covered).toBe(true);
    lock.appState("active");
    expect(lock.getSnapshot().covered).toBe(false);
  });

  it("stays off after an unlock that itself sent the app to the background for a while (the passcode screen on older Android)", async () => {
    const { lock, clock, authenticate } = make();
    let answer!: (r: AuthResult) => void;
    authenticate.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const unlocking = lock.unlock();
    lock.appState("background");
    clock.now += GRACE_MS * 2;
    answer("ok");
    await unlocking;
    lock.appState("active");
    expect(lock.isLocked()).toBe(false);
  });
});

describe("an unlock that does not go through", () => {
  it.each<[AuthResult, string | null]>([["cancelled", null], ["lockout", "lockout"], ["failed", "failed"], ["unprotected", "unprotected"]])("%s leaves it locked and says %s", async (result, problem) => {
    const { lock, authenticate } = make();
    authenticate.mockResolvedValue(result);
    expect(await lock.unlock()).toBe(false);
    expect(lock.isLocked()).toBe(true);
    expect(lock.getSnapshot()).toMatchObject({ problem, busy: false });
  });

  it("five times over leaves it locked with the person still signed in, and the right answer still opens it", async () => {
    const { lock, authenticate } = make();
    authenticate.mockResolvedValue("failed");
    for (let i = 0; i < 5; i++) await lock.unlock();
    expect(lock.isLocked()).toBe(true);
    authenticate.mockResolvedValue("ok");
    expect(await lock.unlock()).toBe(true);
    expect(lock.isLocked()).toBe(false);
    expect(lock.getSnapshot().problem).toBeNull();
  });

  it("because the prompt itself broke leaves it locked", async () => {
    const { lock, authenticate } = make();
    authenticate.mockRejectedValue(new Error("native"));
    expect(await lock.unlock()).toBe(false);
    expect(lock.getSnapshot()).toMatchObject({ problem: "failed", busy: false });
  });

  it("because someone else signed in while it was open unlocks nothing for them", async () => {
    const { lock, authenticate } = make();
    let answer!: (r: AuthResult) => void;
    authenticate.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    const unlocking = lock.unlock();
    lock.setUser(person(["purchasing:approve"], [], 2));
    answer("ok");
    expect(await unlocking).toBe(false);
    expect(lock.isLocked()).toBe(true);
  });

  it("and the prompt is opened once however fast Unlock is tapped", async () => {
    const { lock, authenticate } = make();
    const [a, b] = await Promise.all([lock.unlock(), lock.unlock()]);
    expect([a, b]).toEqual([true, true]);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});

describe("a guarded action", () => {
  it("goes straight on after a recent unlock, and asks again after a while", async () => {
    const { lock, clock, authenticate } = make();
    await lock.unlock();
    clock.now += RECENT_MS;
    expect(await lock.confirm("Approve PO-100")).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(1);

    clock.now += 1;
    expect(await lock.confirm("Approve PO-100")).toBe(true);
    expect(authenticate).toHaveBeenLastCalledWith("Approve PO-100");
    expect(authenticate).toHaveBeenCalledTimes(2);

    // That answer counts as recent too: the next order is not asked about again.
    expect(await lock.confirm("Approve PO-101")).toBe(true);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("asks again when the clock went backwards", async () => {
    const { lock, clock, authenticate } = make();
    await lock.unlock();
    clock.now -= 1;
    await lock.confirm("Approve PO-100");
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it.each<AuthResult>(["cancelled", "failed", "lockout", "unprotected"])("is refused and the app locks when the prompt answers %s", async (result) => {
    const { lock, clock, authenticate } = make();
    await lock.unlock();
    clock.now += RECENT_MS + 1;
    authenticate.mockResolvedValue(result);
    expect(await lock.confirm("Approve PO-100")).toBe(false);
    expect(lock.isLocked()).toBe(true);
  });

  it("is never asked of someone without the lock", async () => {
    const { lock, authenticate } = make(cook);
    expect(await lock.confirm("Raise a credit note")).toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });
});
