// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Linking, Platform } from "react-native";
import { ApiError } from "../src/api/client";
import { routerMock, searchParams } from "../testing/mocks";

// The screens the store needs: legal pages, first run, update, delete account. Real screens through react-native-web; only the server calls are faked.
const mocks = vi.hoisted(() => ({
  state: { current: { state: { phase: "signedOut" } as unknown, busy: false } },
  session: { signIn: vi.fn(), signInWithGoogle: vi.fn(), signOut: vi.fn(), joinOrganisation: vi.fn(), joinLocation: vi.fn(), accountDeleted: vi.fn(), leaveDeletedAccount: vi.fn(), changeLocation: vi.fn() },
  accountApi: { facts: vi.fn(), deleteAccount: vi.fn() },
  legalApi: { load: vi.fn() },
  authApi: { register: vi.fn() },
  appleProof: { current: undefined as undefined | (() => Promise<unknown>) },
}));
vi.mock("../src/runtime/appContext", () => ({ session: mocks.session, accountApi: mocks.accountApi, legalApi: mocks.legalApi, authApi: mocks.authApi, googleEnabled: false, appleEnabled: false, get appleProof() { return mocks.appleProof.current; }, useSession: () => mocks.state.current }));
// The sign-in screen imports the native Apple button, which needs the native runtime.
vi.mock("expo-apple-authentication", () => ({ AppleAuthenticationButton: () => null, AppleAuthenticationButtonType: {}, AppleAuthenticationButtonStyle: {} }));

// The account screen lists what is waiting on the phone; these tests have nothing queued (and the real queue needs the native SQLite module).
vi.mock("../src/runtime/appOutbox", () => ({ outbox: { open: async () => [], subscribe: () => () => {} }, runner: { kick: vi.fn() } }));

import SignIn from "../app/sign-in";
import Account from "../app/(app)/account";
import Legal from "../app/legal";
import UpdateRequired from "../app/update-required";
import FirstRun from "../app/first-run";
import DeleteAccount from "../app/delete-account";
import AccountDeleted from "../app/account-deleted";

const chef = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const setState = (state: unknown, busy = false) => (mocks.state.current = { state, busy });

beforeEach(() => {
  setState({ phase: "signedOut" });
  searchParams.current = {};
});
afterEach(cleanup);

describe("terms and privacy links", () => {
  it("are on the sign-in screen and open the matching page", () => {
    render(<SignIn />);
    fireEvent.click(screen.getByRole("link", { name: "Terms of Service" }));
    expect(routerMock.push).toHaveBeenLastCalledWith({ pathname: "/legal", params: { slug: "terms" } });
    fireEvent.click(screen.getByRole("link", { name: "Privacy Policy" }));
    expect(routerMock.push).toHaveBeenLastCalledWith({ pathname: "/legal", params: { slug: "privacy" } });
  });

  it("are on the account screen too", () => {
    setState({ phase: "ready", user: chef, location: main, locations: [main] });
    render(<Account />);
    fireEvent.click(screen.getByRole("link", { name: "Privacy Policy" }));
    expect(routerMock.push).toHaveBeenLastCalledWith({ pathname: "/legal", params: { slug: "privacy" } });
  });
});

describe("a legal page", () => {
  it("shows the published text natively and asks the server for the page it was opened with", async () => {
    searchParams.current = { slug: "privacy" };
    mocks.legalApi.load.mockResolvedValue({
      status: "ok",
      title: "Privacy Policy",
      blocks: [
        { type: "heading", level: 2, spans: [{ text: "What we keep" }] },
        { type: "paragraph", spans: [{ text: "Your name and " }, { text: "email", bold: true }, { text: "." }] },
        { type: "list", ordered: false, items: [[{ text: "Counts" }], [{ text: "Orders" }]] },
      ],
    });
    render(<Legal />);
    await screen.findByText("What we keep");
    expect(mocks.legalApi.load).toHaveBeenCalledWith("privacy");
    expect(screen.getByText("Privacy Policy")).toBeTruthy();
    expect(screen.getByText("Counts")).toBeTruthy();
  });

  it("opens a link in the page in the browser", async () => {
    const open = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    searchParams.current = { slug: "terms" };
    mocks.legalApi.load.mockResolvedValue({ status: "ok", title: "Terms", blocks: [{ type: "paragraph", spans: [{ text: "Write to us", href: "mailto:hello@x.test" }] }] });
    render(<Legal />);
    fireEvent.click(await screen.findByText("Write to us"));
    expect(open).toHaveBeenCalledWith("mailto:hello@x.test");
  });

  it("says plainly when the owner has not published it yet, with the page's own name still on top", async () => {
    searchParams.current = { slug: "terms" };
    mocks.legalApi.load.mockResolvedValue({ status: "unavailable" });
    render(<Legal />);
    await screen.findByText("This page isn't available in the app yet. Please check back soon.");
    expect(screen.getByText("Terms of Service")).toBeTruthy();
  });

  it("offers to try again when the server cannot be reached", async () => {
    searchParams.current = { slug: "terms" };
    mocks.legalApi.load.mockResolvedValueOnce({ status: "offline" }).mockResolvedValueOnce({ status: "ok", title: "Terms", blocks: [{ type: "paragraph", spans: [{ text: "Be kind." }] }] });
    render(<Legal />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByText("Be kind.");
  });

  it("does not ask the server for a page it does not know", async () => {
    mocks.legalApi.load.mockClear();
    searchParams.current = { slug: "../admin" };
    render(<Legal />);
    await screen.findByText("This page isn't available in the app yet. Please check back soon.");
    expect(mocks.legalApi.load).not.toHaveBeenCalled();
  });
});

describe("update screen", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it("links to this phone's store from the 426 body", () => {
    Platform.OS = "ios";
    const open = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    setState({ phase: "updateRequired", minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" } });
    render(<UpdateRequired />);
    expect(screen.getByText(/Version 1\.2\.0 or later is needed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open the App Store" }));
    expect(open).toHaveBeenCalledWith("https://apps.apple.com/app/id1");
  });

  it("uses the Android link on Android", () => {
    Platform.OS = "android";
    const open = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    setState({ phase: "updateRequired", minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" } });
    render(<UpdateRequired />);
    fireEvent.click(screen.getByRole("button", { name: "Open Google Play" }));
    expect(open).toHaveBeenLastCalledWith("https://play.google.com/store/apps/details?id=x");
  });

  it("shows no link when none is set for this phone's store (only the other store has one), just where to update", () => {
    Platform.OS = "android";
    setState({ phase: "updateRequired", minVersion: "", storeUrls: { ios: "https://apps.apple.com/app/id1" } });
    render(<UpdateRequired />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Update CulinAIre Kitchen from Google Play.")).toBeTruthy();
    expect(screen.queryByText(/Version/)).toBeNull();
  });
});

describe("first run", () => {
  it("asks for the organisation's join key first, and sends it", () => {
    setState({ phase: "firstRun", user: chef, organisationId: null });
    render(<FirstRun />);
    expect(screen.getByText("Join your kitchen")).toBeTruthy();
    const join = screen.getByRole("button", { name: "Join" });
    expect((join as HTMLButtonElement).getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText("Join key"), { target: { value: "CULINAIRE-ABC123" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(mocks.session.joinOrganisation).toHaveBeenCalledWith("CULINAIRE-ABC123");
    expect(mocks.session.joinLocation).not.toHaveBeenCalled();
  });

  it("asks for the location key once the person is in an organisation", () => {
    setState({ phase: "firstRun", user: chef, organisationId: 1 });
    render(<FirstRun />);
    expect(screen.getByText("Join your location")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Location key"), { target: { value: "KITCHEN-XYZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(mocks.session.joinLocation).toHaveBeenCalledWith("KITCHEN-XYZ");
  });

  it("starts the location step with an empty field once the organisation join succeeds", () => {
    setState({ phase: "firstRun", user: chef, organisationId: null });
    const { rerender } = render(<FirstRun />);
    fireEvent.change(screen.getByLabelText("Join key"), { target: { value: "CULINAIRE-ABC123" } });
    setState({ phase: "firstRun", user: chef, organisationId: 1 });
    rerender(<FirstRun />);
    expect(screen.getByText("Join your location")).toBeTruthy();
    expect((screen.getByLabelText("Location key") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "Join" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("shows why a key was refused and offers sign out", () => {
    setState({ phase: "firstRun", user: chef, organisationId: null, error: "That key wasn't found. Check it with your manager." });
    render(<FirstRun />);
    expect(screen.getByText("That key wasn't found. Check it with your manager.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.session.signOut).toHaveBeenCalled();
  });
});

describe("no plan, price, purchase or upgrade is offered on any store-plumbing screen", () => {
  const selling = /\b(pricing|price|purchase|checkout|paywall|billing|subscribe|subscription|upgrade|premium|free trial)\b/i;

  it.each([
    ["sign-in", () => <SignIn />, { phase: "signedOut" }],
    ["account", () => <Account />, { phase: "ready", user: chef, location: main, locations: [main] }],
    ["first run (organisation)", () => <FirstRun />, { phase: "firstRun", user: chef, organisationId: null }],
    ["first run (location)", () => <FirstRun />, { phase: "firstRun", user: chef, organisationId: 1 }],
    ["update required", () => <UpdateRequired />, { phase: "updateRequired", minVersion: "1.2.0", storeUrls: { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" } }],
    ["account deleted", () => <AccountDeleted />, { phase: "signedOut" }],
  ])("%s screen", (_name, screenFor, state) => {
    setState(state);
    const { container } = render(screenFor());
    expect(container.textContent).not.toMatch(selling);
  });

  it("legal screen", async () => {
    searchParams.current = { slug: "terms" };
    mocks.legalApi.load.mockResolvedValue({ status: "unavailable" });
    const { container } = render(<Legal />);
    await screen.findByText("This page isn't available in the app yet. Please check back soon.");
    expect(container.textContent).not.toMatch(selling);
  });

  it("delete-account screen", async () => {
    mocks.accountApi.facts.mockResolvedValue({ hasPassword: true, hasApple: false, mfaEnabled: false, email: "c@x.test" });
    setState({ phase: "ready", user: chef, location: main, locations: [main] });
    const { container } = render(<DeleteAccount />);
    await screen.findByLabelText("Your password");
    expect(container.textContent).not.toMatch(selling);
  });
});

describe("delete account", () => {
  const withPassword = { hasPassword: true, hasApple: false, mfaEnabled: false, email: "c@x.test" };
  const googleOnly = { hasPassword: false, hasApple: false, mfaEnabled: false, email: "g@x.test" };
  const appleOnly = { hasPassword: false, hasApple: true, mfaEnabled: false, email: "x1y2@privaterelay.appleid.com" };
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  beforeEach(() => {
    mocks.accountApi.facts.mockReset();
    mocks.accountApi.deleteAccount.mockReset();
    mocks.session.accountDeleted.mockReset();
    mocks.appleProof.current = undefined;
    setState({ phase: "ready", user: chef, location: main, locations: [main] });
  });

  it("is reached from the account screen", () => {
    render(<Account />);
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(routerMock.push).toHaveBeenLastCalledWith("/delete-account");
  });

  it("asks for the password, keeps the button off until it is typed, deletes, then lets the session clear the phone", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.accountApi.deleteAccount.mockResolvedValue(undefined);
    render(<DeleteAccount />);
    await screen.findByLabelText("Your password");
    const button = screen.getByRole("button", { name: "Delete my account" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fill("Your password", "hunter2");
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(mocks.session.accountDeleted).toHaveBeenCalled());
    expect(mocks.accountApi.deleteAccount).toHaveBeenCalledWith({ password: "hunter2" });
  });

  it("asks an account with no password for its email typed back, and an authenticator code when MFA is on", async () => {
    mocks.accountApi.facts.mockResolvedValue({ ...googleOnly, mfaEnabled: true });
    mocks.accountApi.deleteAccount.mockResolvedValue(undefined);
    render(<DeleteAccount />);
    await screen.findByLabelText("Your email");
    expect(screen.queryByLabelText("Your password")).toBeNull();
    fill("Your email", " g@x.test ");
    fill("Authenticator code", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(mocks.accountApi.deleteAccount).toHaveBeenCalledWith({ confirmEmail: "g@x.test", mfaCode: "123456" }));
  });

  it("keeps the person here with a plain reason when the server refuses, and deletes nothing locally", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.accountApi.deleteAccount.mockRejectedValue(new ApiError("forbidden", "Incorrect password.", 403, undefined, "INVALID_CREDENTIALS"));
    render(<DeleteAccount />);
    await screen.findByLabelText("Your password");
    fill("Your password", "nope");
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await screen.findByText("That password isn't right.");
    expect(mocks.session.accountDeleted).not.toHaveBeenCalled();
  });

  it("shows the code field when the server asks for one the profile did not mention", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    mocks.accountApi.deleteAccount.mockRejectedValue(new ApiError("forbidden", "x", 403, undefined, "MFA_REQUIRED"));
    render(<DeleteAccount />);
    await screen.findByLabelText("Your password");
    fill("Your password", "pw");
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await screen.findByLabelText("Authenticator code");
    expect(screen.getByText("Enter your authenticator code.")).toBeTruthy();
  });

  it("offers sign out when only a fresh sign-in will do (an account with no password signed in too long ago)", async () => {
    mocks.accountApi.facts.mockResolvedValue(googleOnly);
    mocks.accountApi.deleteAccount.mockRejectedValue(new ApiError("forbidden", "x", 403, undefined, "RECENT_SIGN_IN_REQUIRED"));
    render(<DeleteAccount />);
    await screen.findByLabelText("Your email");
    fill("Your email", "g@x.test");
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await screen.findByText("For your security, sign out, sign back in, then delete your account.");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(mocks.session.signOut).toHaveBeenCalled();
  });

  it("says what to do first when the person is the only admin of an organisation", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    const sentence = "You are the only admin of Main Kitchen. Make another member an admin first, then delete your account.";
    mocks.accountApi.deleteAccount.mockRejectedValue(new ApiError("conflict", sentence, 409, undefined, "OWNERSHIP_TRANSFER_REQUIRED"));
    render(<DeleteAccount />);
    await screen.findByLabelText("Your password");
    fill("Your password", "pw");
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await screen.findByText(sentence);
  });

  describe("an account that signed up with Apple (no password)", () => {
    const credential = { identityToken: "apple-id-token", nonce: "a".repeat(64) };

    it("confirms with a fresh Apple sign-in instead of a typed email (a private-relay address cannot be typed)", async () => {
      mocks.appleProof.current = vi.fn(async () => credential);
      mocks.accountApi.facts.mockResolvedValue(appleOnly);
      mocks.accountApi.deleteAccount.mockResolvedValue(undefined);
      render(<DeleteAccount />);
      await screen.findByText(/Apple confirms it's you/);
      expect(screen.queryByLabelText("Your email")).toBeNull();
      expect(screen.queryByLabelText("Your password")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
      await waitFor(() => expect(mocks.session.accountDeleted).toHaveBeenCalled());
      expect(mocks.accountApi.deleteAccount).toHaveBeenCalledWith({ apple: credential });
    });

    it("deletes nothing when the person closes Apple's sheet", async () => {
      mocks.appleProof.current = vi.fn(async () => null);
      mocks.accountApi.facts.mockResolvedValue(appleOnly);
      render(<DeleteAccount />);
      await screen.findByText(/Apple confirms it's you/);
      fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
      await waitFor(() => expect((mocks.appleProof.current as ReturnType<typeof vi.fn>)).toHaveBeenCalled());
      await screen.findByRole("button", { name: "Delete my account" }); // back to idle, not "Deleting…"
      expect(mocks.accountApi.deleteAccount).not.toHaveBeenCalled();
      expect(mocks.session.accountDeleted).not.toHaveBeenCalled();
    });

    it("says so when Apple's sheet fails, and deletes nothing", async () => {
      mocks.appleProof.current = vi.fn(async () => { throw new Error("no sheet"); });
      mocks.accountApi.facts.mockResolvedValue(appleOnly);
      render(<DeleteAccount />);
      await screen.findByText(/Apple confirms it's you/);
      fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
      await screen.findByText("Apple sign-in didn't work. Try again.");
      expect(mocks.accountApi.deleteAccount).not.toHaveBeenCalled();
    });

    it("names an Apple sign-in the server refused", async () => {
      mocks.appleProof.current = vi.fn(async () => credential);
      mocks.accountApi.facts.mockResolvedValue(appleOnly);
      mocks.accountApi.deleteAccount.mockRejectedValue(new ApiError("forbidden", "x", 403, undefined, "INVALID_CREDENTIALS"));
      render(<DeleteAccount />);
      await screen.findByText(/Apple confirms it's you/);
      fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
      await screen.findByText("That Apple sign-in doesn't match this account.");
    });

    it("falls back to the typed email where this phone has no Apple sheet (the server then also wants a recent sign-in)", async () => {
      mocks.accountApi.facts.mockResolvedValue(appleOnly);
      render(<DeleteAccount />);
      await screen.findByLabelText("Your email");
    });

    it("still asks a password account for its password, even if it is also linked to Apple", async () => {
      mocks.appleProof.current = vi.fn(async () => credential);
      mocks.accountApi.facts.mockResolvedValue({ ...withPassword, hasApple: true });
      render(<DeleteAccount />);
      await screen.findByLabelText("Your password");
    });
  });

  it("can be cancelled", async () => {
    mocks.accountApi.facts.mockResolvedValue(withPassword);
    render(<DeleteAccount />);
    await screen.findByLabelText("Your password");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(routerMock.back).toHaveBeenCalled();
  });

  it("says so when the account details cannot be loaded, rather than asking for the wrong proof", async () => {
    mocks.accountApi.facts.mockRejectedValue(new ApiError("network"));
    render(<DeleteAccount />);
    await screen.findByText("Couldn't load your account. Try again.");
    expect(screen.queryByLabelText("Your password")).toBeNull();
  });

  it("ends on a result screen that goes back to sign-in", () => {
    render(<AccountDeleted />);
    expect(screen.getByText("Your account has been deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(mocks.session.leaveDeletedAccount).toHaveBeenCalled();
  });
});
