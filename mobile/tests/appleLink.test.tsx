// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ApiError } from "../src/api/client";
import { routerMock } from "../testing/mocks";

// Adding Sign in with Apple to a signed-in account: the real screens through react-native-web; only the server calls and Apple's sheet are faked.
const mocks = vi.hoisted(() => ({
  state: { current: { state: { phase: "signedOut" } as unknown, busy: false } },
  session: { signOut: vi.fn(), changeLocation: vi.fn() },
  accountApi: { facts: vi.fn() },
  authApi: { linkApple: vi.fn() },
  appleEnabled: { current: true },
  appleCredential: vi.fn(),
}));
vi.mock("../src/runtime/appContext", () => ({
  session: mocks.session,
  accountApi: mocks.accountApi,
  authApi: mocks.authApi,
  get appleEnabled() { return mocks.appleEnabled.current; },
  appleCredential: mocks.appleCredential,
  useSession: () => mocks.state.current,
}));
// The account screen lists what is waiting on the phone; nothing is queued here (and the real queue needs the native SQLite module).
vi.mock("../src/runtime/appOutbox", () => ({ outbox: { open: async () => [], subscribe: () => () => {} }, runner: { kick: vi.fn() } }));

import Account from "../app/(app)/account";
import LinkApple from "../app/link-apple";

const chef = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const credential = { identityToken: "apple-id-token", nonce: "a".repeat(64), authorizationCode: "CODE" };
const withPassword = { hasPassword: true, hasApple: false, mfaEnabled: false, email: "c@x.test" };
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const off = () => screen.getByRole("button", { name: "Add Sign in with Apple" }).getAttribute("aria-disabled") === "true";
const add = () => fireEvent.click(screen.getByRole("button", { name: "Add Sign in with Apple" }));

beforeEach(() => {
  mocks.state.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false };
  mocks.appleEnabled.current = true;
  mocks.accountApi.facts.mockReset();
  mocks.authApi.linkApple.mockReset();
  mocks.appleCredential.mockReset().mockResolvedValue(credential);
  mocks.session.signOut.mockReset();
  routerMock.push.mockClear();
  routerMock.back.mockClear();
});
afterEach(cleanup);

describe("the account screen", () => {
  it("offers Add Sign in with Apple on iPhone and iPad", () => {
    render(<Account />);
    fireEvent.click(screen.getByRole("button", { name: "Add Sign in with Apple" }));
    expect(routerMock.push).toHaveBeenLastCalledWith("/link-apple");
  });

  it("does not offer it on Android", () => {
    mocks.appleEnabled.current = false;
    render(<Account />);
    expect(screen.queryByRole("button", { name: "Add Sign in with Apple" })).toBeNull();
  });
});

describe("adding Sign in with Apple", () => {
  it("asks an email-and-password account for its password, keeps the button off until it is typed, then links with a fresh credential", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.authApi.linkApple.mockResolvedValue(undefined);
    render(<LinkApple />);
    await screen.findByLabelText("Your password");
    expect(off()).toBe(true);
    fill("Your password", "hunter2");
    add();
    await screen.findByText("Sign in with Apple is now on your account.");
    expect(mocks.authApi.linkApple).toHaveBeenCalledWith(credential, { password: "hunter2" });
    expect(screen.queryByRole("button", { name: "Add Sign in with Apple" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(routerMock.back).toHaveBeenCalled();
  });

  it("asks for the authenticator code when the account has MFA, and sends it with the password", async () => {
    mocks.accountApi.facts.mockResolvedValue({ ...withPassword, mfaEnabled: true });
    mocks.authApi.linkApple.mockResolvedValue(undefined);
    render(<LinkApple />);
    await screen.findByLabelText("Authenticator code");
    fill("Your password", "hunter2");
    expect(off()).toBe(true);
    fill("Authenticator code", "123456");
    add();
    await screen.findByText("Sign in with Apple is now on your account.");
    expect(mocks.authApi.linkApple).toHaveBeenCalledWith(credential, { password: "hunter2", mfaCode: "123456" });
  });

  it("asks an account with no password for no password (it signed in recently enough, or the server says so)", async () => {
    mocks.accountApi.facts.mockResolvedValue({ ...withPassword, hasPassword: false });
    mocks.authApi.linkApple.mockResolvedValue(undefined);
    render(<LinkApple />);
    await waitFor(() => expect(off()).toBe(false));
    expect(screen.queryByLabelText("Your password")).toBeNull();
    add();
    await screen.findByText("Sign in with Apple is now on your account.");
    expect(mocks.authApi.linkApple).toHaveBeenCalledWith(credential, {});
  });

  it("says nothing and changes nothing when the person closes Apple's sheet", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.appleCredential.mockResolvedValue(null);
    const { container } = render(<LinkApple />);
    await screen.findByLabelText("Your password");
    fill("Your password", "hunter2");
    add();
    await waitFor(() => expect(mocks.appleCredential).toHaveBeenCalled());
    await waitFor(() => expect(off()).toBe(false));
    expect(mocks.authApi.linkApple).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/didn't work|Couldn't|isn't/);
  });

  it("says Apple didn't work when the sheet itself fails, and calls the server for nothing", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.appleCredential.mockRejectedValue(new Error("no token"));
    render(<LinkApple />);
    await screen.findByLabelText("Your password");
    fill("Your password", "hunter2");
    add();
    await screen.findByText("Apple sign-in didn't work. Try again.");
    expect(mocks.authApi.linkApple).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_CREDENTIALS", "That password isn't right."],
    ["APPLE_ALREADY_LINKED", "That Apple ID is already used by another account, or this account already has a different one."],
  ])("keeps the person here with a plain reason when the server refuses with %s", async (code, text) => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.authApi.linkApple.mockRejectedValue(new ApiError("forbidden", "x", 403, undefined, code));
    render(<LinkApple />);
    await screen.findByLabelText("Your password");
    fill("Your password", "hunter2");
    add();
    await screen.findByText(text);
    expect(screen.queryByText("Sign in with Apple is now on your account.")).toBeNull();
  });

  it("shows the code field when the server asks for one the profile did not mention", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.authApi.linkApple.mockRejectedValue(new ApiError("forbidden", "x", 403, undefined, "MFA_REQUIRED"));
    render(<LinkApple />);
    await screen.findByLabelText("Your password");
    fill("Your password", "pw");
    add();
    await screen.findByLabelText("Authenticator code");
    expect(screen.getByText("Enter your authenticator code.")).toBeTruthy();
  });

  it("offers sign out when only a fresh sign-in will do", async () => {
    mocks.accountApi.facts.mockResolvedValue({ ...withPassword, hasPassword: false });
    mocks.authApi.linkApple.mockRejectedValue(new ApiError("forbidden", "x", 403, undefined, "RECENT_SIGN_IN_REQUIRED"));
    render(<LinkApple />);
    await waitFor(() => expect(off()).toBe(false));
    add();
    await screen.findByText("For your security, sign out, sign back in, then add Sign in with Apple.");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.session.signOut).toHaveBeenCalled();
  });

  it("shows the already-linked state, with no form and no call to Apple", async () => {
    mocks.accountApi.facts.mockResolvedValue({ ...withPassword, hasApple: true });
    render(<LinkApple />);
    await screen.findByText("Sign in with Apple is already on your account.");
    expect(screen.queryByRole("button", { name: "Add Sign in with Apple" })).toBeNull();
    expect(screen.queryByLabelText("Your password")).toBeNull();
    expect(mocks.appleCredential).not.toHaveBeenCalled();
  });

  it("says the account could not be loaded, and does not offer the form", async () => {
    mocks.accountApi.facts.mockRejectedValue(new ApiError("network"));
    render(<LinkApple />);
    await screen.findByText("Couldn't load your account. Try again.");
    expect(screen.queryByRole("button", { name: "Add Sign in with Apple" })).toBeNull();
  });

  it("tells a person who hides their email that this stays one account", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    render(<LinkApple />);
    await screen.findByLabelText("Your password");
    expect(screen.getByText(/Hide My Email/)).toBeTruthy();
    expect(screen.getByText(/not a second one/)).toBeTruthy();
  });
});

describe("Hide My Email: a person registered by email who adds Apple ends with one account", () => {
  it("sends the Apple credential (its relay address is never typed or sent) with the signed-in account's proof, so the server joins the Apple ID to this account", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.authApi.linkApple.mockResolvedValue(undefined);
    // Apple's identity token for a hidden email carries a private-relay address; the screen never reads it, the server never matches by it.
    mocks.appleCredential.mockResolvedValue({ ...credential, identityToken: "token-for-x1y2@privaterelay.appleid.com" });
    render(<LinkApple />);
    await screen.findByLabelText("Your password");
    fill("Your password", "hunter2");
    add();
    await screen.findByText("Sign in with Apple is now on your account.");
    expect(mocks.authApi.linkApple).toHaveBeenCalledTimes(1);
    expect(mocks.authApi.linkApple.mock.calls[0]?.[1]).toEqual({ password: "hunter2" });
  });
});

describe("tablet width", () => {
  it.each([
    ["an iPad (portrait)", 820, 1180],
    ["an iPad (landscape)", 1180, 820],
    ["a phone", 390, 844],
  ])("keeps the form in the 560 column on %s", async (_name, width, height) => {
    window.innerWidth = width;
    window.innerHeight = height;
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    render(<LinkApple />);
    const field = await screen.findByLabelText("Your password");
    // Screen puts its children in one centred column of at most COLUMN_WIDTH; the form must be inside it.
    let column = field.parentElement as HTMLElement;
    while (parseFloat(getComputedStyle(column).maxWidth) !== 560) column = column.parentElement as HTMLElement;
    expect(getComputedStyle(column).width).toBe("100%");
    expect(getComputedStyle(column.parentElement as HTMLElement).alignItems).toBe("center");
  });
});
