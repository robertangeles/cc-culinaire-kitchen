// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Alert } from "react-native";
import { useSyncExternalStore } from "react";
import { harness, makeHarness } from "./harness";
import { routerMock, sessionMock, sessionState } from "../testing/mocks";

vi.mock("../src/app/countContext", async () => {
  const { harness } = await import("./harness");
  return {
    useCount: () => {
      const snap = useSyncExternalStore(harness.store.subscribe, harness.store.getSnapshot);
      return { store: harness.store, snap };
    },
  };
});
vi.mock("../src/app/appContext", async () => {
  const { sessionMock, sessionState } = await import("../testing/mocks");
  return { session: sessionMock, useSession: () => sessionState.current };
});
vi.mock("../src/app/appOutbox", async () => {
  const { harness } = await import("./harness");
  return { get outbox() { return harness.outbox; }, runner: { kick: vi.fn() } };
});

import Areas from "../app/index";
import Attention from "../app/attention";
import SignIn from "../app/sign-in";
import Mfa from "../app/mfa";
import ChooseLocation from "../app/location";

const chef = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"] };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const signedIn = () => (sessionState.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false });

beforeEach(() => {
  signedIn();
});

describe("areas list", () => {
  it("shows each area with its progress and which areas share items", async () => {
    await makeHarness();
    render(<Areas />);
    expect(screen.getByText("Main Kitchen")).toBeTruthy();
    expect(screen.getByText("Bar")).toBeTruthy();
    expect(screen.getAllByText("0 of 2").length).toBe(1);
    expect(screen.getByText("Shares items with Stock Room")).toBeTruthy();
    expect(screen.getByText("0 of 1")).toBeTruthy(); // Kitchen
  });

  it("opens an area this chef holds without asking the server again", async () => {
    const { api } = await makeHarness();
    render(<Areas />);
    fireEvent.click(screen.getByRole("button", { name: /^Bar,/ }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/area/[name]", params: { name: "Bar" } }));
    expect(api.claimArea).not.toHaveBeenCalled();
  });

  it("claims a free area online and opens it", async () => {
    const { api } = await makeHarness();
    render(<Areas />);
    fireEvent.click(screen.getByRole("button", { name: /^Kitchen,/ }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/area/[name]", params: { name: "Kitchen" } }));
    expect(api.claimArea).toHaveBeenCalledWith("S1", "Kitchen");
  });

  it.each([
    ["held", "Another chef is counting that area."],
    ["submitted", "That area was already sent for review."],
  ])("explains an area that is %s", async (status, sentence) => {
    await makeHarness({ api: { claimArea: vi.fn(async () => ({ status })) } });
    render(<Areas />);
    fireEvent.click(screen.getByRole("button", { name: /^Kitchen,/ }));
    await screen.findByText(sentence);
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it("says to connect when a free area can't be claimed without signal", async () => {
    const { ApiError } = await import("../src/api/client");
    await makeHarness({ api: { claimArea: vi.fn(async () => { throw new ApiError("network"); }) } });
    render(<Areas />);
    fireEvent.click(screen.getByRole("button", { name: /^Kitchen,/ }));
    await screen.findByText("Connect to start counting this area.");
  });

  it("shows the offline banner and a needs-attention link when counts are stuck", async () => {
    const { ApiError } = await import("../src/api/client");
    const { outbox, counts, api } = await makeHarness({ sendFails: new ApiError("bad_request", "Cannot count: category is SUBMITTED", 400) });
    await counts.saveCount("Bar", { ingredientId: "i2", ingredientName: "Gin", rawQty: 2, countedUnit: "L" });
    await outbox.drain();
    api.activeSession.mockRejectedValueOnce(new ApiError("network"));
    await counts.refresh();
    render(<Areas />);
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "1 count needs attention" }));
    expect(routerMock.push).toHaveBeenCalledWith("/attention");
  });

  it("tells the chef when another account's counts are waiting on this phone", async () => {
    const { rows, counts } = await makeHarness();
    // Left by someone who signed out with a count unsent.
    rows.set("theirs", { id: "theirs", userId: 99, status: "SAVED_LOCAL", attempts: 0, nextAttemptAt: 0, createdAt: 1, updatedAt: 1, command: { sessionId: "S1", categoryName: "Bar", ingredientId: "i1", ingredientName: "Shiraz", rawQty: 1, countedUnit: "kg", claimRevision: 1 } });
    await counts.refresh();
    render(<Areas />);
    expect(screen.getByText(/1 count from another account is waiting on this phone/)).toBeTruthy();
  });

  it("offers Change location only to an account with more than one location", async () => {
    await makeHarness();
    const { unmount } = render(<Areas />);
    expect(screen.queryByRole("button", { name: "Change location" })).toBeNull();
    unmount();

    const other = { ...main, storeLocationId: "L2", locationName: "Second Kitchen" };
    sessionState.current = { state: { phase: "ready", user: chef, location: main, locations: [main, other] }, busy: false };
    render(<Areas />);
    fireEvent.click(screen.getByRole("button", { name: "Change location" }));
    expect(sessionMock.changeLocation).toHaveBeenCalled();
  });

  it("says when no stock take is open", async () => {
    await makeHarness({ api: { activeSession: vi.fn(async () => null) } });
    render(<Areas />);
    expect(screen.getByText("No stock take is open. Ask your manager to open one on the web.")).toBeTruthy();
  });
});

describe("needs attention", () => {
  async function stuck(message: string, status = 400, code: "bad_request" | "forbidden" = "bad_request") {
    const { ApiError } = await import("../src/api/client");
    const h = await makeHarness({ sendFails: new ApiError(code, message, status) });
    await h.counts.saveCount("Bar", { ingredientId: "i1", ingredientName: "Shiraz", rawQty: 6, countedUnit: "kg" });
    await h.outbox.drain();
    await h.counts.refresh();
    return h;
  }

  it("keeps the number the chef typed and says in one sentence what happened", async () => {
    await stuck("Cannot count: category is SUBMITTED");
    render(<Attention />);
    expect(screen.getByText("You counted 6 kg.")).toBeTruthy();
    expect(screen.getByText(/This area was already sent for review/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enter it again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard this count" })).toBeTruthy();
  });

  it("offers Enter it again when the claim changed, and goes to that area", async () => {
    await stuck("This count was queued under an earlier claim; recount under the current claim", 403, "forbidden");
    render(<Attention />);
    fireEvent.click(screen.getByRole("button", { name: "Enter it again" }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/area/[name]", params: { name: "Bar" } }));
  });

  it("asks before discarding, naming the item and quantity, and keeps a record when confirmed", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const { outbox } = await stuck("Cannot count: category is SUBMITTED");
    render(<Attention />);
    fireEvent.click(screen.getByRole("button", { name: "Discard this count" }));
    expect(alert).toHaveBeenCalledWith("Discard 6 kg of Shiraz?", expect.any(String), expect.any(Array));

    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === "Discard")!.onPress!();
    await waitFor(async () => expect((await outbox.entriesFor("S1", "Bar"))[0].status).toBe("DISCARDED"));
    alert.mockRestore();
  });

  it("does not offer Enter it again for a count from a stock take that is no longer open", async () => {
    const { ApiError } = await import("../src/api/client");
    const h = await makeHarness({ sendFails: new ApiError("forbidden", "This count was queued under an earlier claim; recount under the current claim", 403) });
    await h.outbox.enqueue({ sessionId: "OLD-SESSION", categoryName: "Cellar", ingredientId: "x", ingredientName: "Rum", rawQty: 2, countedUnit: "kg", claimRevision: 1 });
    await h.outbox.drain();
    await h.counts.refresh();
    render(<Attention />);
    expect(screen.getByText("Rum · Cellar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enter it again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard this count" })).toBeTruthy();
  });

  it("says so when nothing is stuck", async () => {
    await makeHarness();
    render(<Attention />);
    expect(screen.getByText("Nothing needs attention.")).toBeTruthy();
  });
});

describe("sign-in screens", () => {
  it("disables Sign in until both fields are filled, then signs in with the trimmed email", () => {
    sessionState.current = { state: { phase: "signedOut" }, busy: false };
    render(<SignIn />);
    const button = () => screen.getByRole("button", { name: "Sign in" });
    expect(button().getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: " c@x.test " } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    expect(button().getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(button());
    expect(sessionMock.signIn).toHaveBeenCalledWith("c@x.test", "pw");
  });

  it("shows the plain sentence for a failed sign-in and 'Signing in…' while busy", () => {
    sessionState.current = { state: { phase: "signedOut", error: "Email or password is wrong." }, busy: false };
    const { unmount } = render(<SignIn />);
    expect(screen.getByText("Email or password is wrong.")).toBeTruthy();
    unmount();
    sessionState.current = { state: { phase: "signedOut" }, busy: true };
    render(<SignIn />);
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeTruthy();
  });

  it("takes only six digits for the code and verifies", () => {
    sessionState.current = { state: { phase: "mfa", mfaSessionToken: "M" }, busy: false };
    render(<Mfa />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "12a34567" } });
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe("123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(sessionMock.submitCode).toHaveBeenCalledWith("123456");
  });

  it("marks the current location and lets the chef cancel a change", () => {
    const other = { ...main, storeLocationId: "L2", locationName: "Second Kitchen" };
    sessionState.current = { state: { phase: "chooseLocation", user: chef, locations: [main, other], current: main }, busy: false };
    render(<ChooseLocation />);
    expect(screen.getByRole("button", { name: "Main Kitchen, current location" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sessionMock.cancelChangeLocation).toHaveBeenCalled();
  });

  it("has no Cancel on the first sign-in picker", () => {
    sessionState.current = { state: { phase: "chooseLocation", user: chef, locations: [main] }, busy: false };
    render(<ChooseLocation />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("lists the locations and chooses the tapped one", () => {
    const other = { ...main, storeLocationId: "L2", locationName: "Second Kitchen" };
    sessionState.current = { state: { phase: "chooseLocation", user: chef, locations: [main, other] }, busy: false };
    render(<ChooseLocation />);
    fireEvent.click(screen.getByRole("button", { name: "Second Kitchen" }));
    expect(sessionMock.chooseLocation).toHaveBeenCalledWith("L2");
    expect(harness).toBeTruthy();
  });
});
