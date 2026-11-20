// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { makeHarness } from "./harness";
import { reduceMotion, routerMock, searchParams } from "../testing/mocks";

vi.mock("../src/app/countContext", async () => {
  const { harness } = await import("./harness");
  return {
    useCount: () => {
      const snap = useSyncExternalStore(harness.store.subscribe, harness.store.getSnapshot);
      return { store: harness.store, snap };
    },
  };
});

import AreaCount from "../app/area/[name]";

const key = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));
const type = (digits: string) => [...digits].forEach((d) => key(d));
/** Wait for the header that says which item is showing. (The faded "next" list also shows the next item's name.) */
const atItem = (n: number) => screen.findByText(`Bar · item ${n} of 2`);
const saveButton = () => screen.getByRole("button", { name: /Save and next|Saving/ });

beforeEach(() => {
  searchParams.current = { name: "Bar" };
});

describe("count screen", () => {
  it("shows the item, its unit, and which other area holds it", async () => {
    await makeHarness();
    render(<AreaCount />);
    expect(screen.getByText("Shiraz")).toBeTruthy();
    expect(screen.getByText("Count in kg")).toBeTruthy();
    expect(screen.getByText("Also in Stock Room")).toBeTruthy();
  });

  it("types a number on the keypad and only enables Save once something is typed", async () => {
    await makeHarness();
    render(<AreaCount />);
    expect(saveButton().getAttribute("aria-disabled")).toBe("true");
    type("42");
    expect(screen.getByLabelText("Shiraz, kg, 42")).toBeTruthy();
    expect(saveButton().getAttribute("aria-disabled")).not.toBe("true");
  });

  it("saves the count to the phone's outbox under the current claim and moves to the next item", async () => {
    const { outbox } = await makeHarness();
    render(<AreaCount />);
    type("42");
    fireEvent.click(saveButton());
    await atItem(2);
    const [entry] = await outbox.entriesFor("S1", "Bar");
    expect(entry.command).toMatchObject({ ingredientId: "i1", ingredientName: "Shiraz", rawQty: 42, countedUnit: "kg", claimRevision: 2 });
  });

  it('"0 - none here" on a blank entry records a deliberate zero', async () => {
    const { outbox } = await makeHarness();
    render(<AreaCount />);
    key("Zero, none here");
    expect(screen.getByLabelText("Shiraz, kg, 0")).toBeTruthy();
    fireEvent.click(saveButton());
    await atItem(2);
    expect((await outbox.entriesFor("S1", "Bar"))[0].command.rawQty).toBe(0);
  });

  it("refuses a digit past 99,999 and says why", async () => {
    await makeHarness();
    render(<AreaCount />);
    type("99999");
    key("1");
    expect(screen.getByText("The largest number is 99,999.")).toBeTruthy();
    expect(screen.getByLabelText("Shiraz, kg, 99999")).toBeTruthy();
  });

  it("Skip leaves an item uncounted and moves on; Previous comes back", async () => {
    const { outbox } = await makeHarness();
    render(<AreaCount />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await atItem(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await atItem(1);
    expect(await outbox.entriesFor("S1", "Bar")).toEqual([]);
  });

  it("shows how far a count has got: Saved on this phone, then Accepted once sent", async () => {
    const { outbox } = await makeHarness();
    render(<AreaCount />);
    type("5");
    fireEvent.click(saveButton());
    await atItem(2);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await atItem(1);
    await screen.findByText("Saved on this phone");
    await outbox.drain();
    await screen.findByText("Accepted");
  });
});

describe("card motion", () => {
  it("advances to the next item with motion on", async () => {
    await makeHarness();
    render(<AreaCount />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await atItem(2);
    expect(screen.getByText("Gin")).toBeTruthy();
  });

  it("advances just the same, with no animation, when the phone asks to reduce motion", async () => {
    reduceMotion.current = true;
    await makeHarness();
    render(<AreaCount />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await atItem(2);
    // No in-flight transform: the card is at rest the moment it appears.
    const card = screen.getByText("Count in L").closest("div[style*='transform']") as HTMLElement | null;
    expect(card?.style.opacity === "" || card?.style.opacity === "1").toBe(true);
  });
});

describe("a typed number is never dropped silently", () => {
  it("asks before Previous, Skip or Review throws away a number that was not saved, and keeps it on Keep typing", async () => {
    const { Alert } = await import("react-native");
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    await makeHarness();
    render(<AreaCount />);
    type("7");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(alert).toHaveBeenCalledWith("Discard the number you typed?", "It has not been saved.", expect.any(Array));
    expect(screen.getByLabelText("Shiraz, kg, 7")).toBeTruthy(); // still there, still on item 1

    const buttons = alert.mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    buttons.find((b) => b.text === "Discard")!.onPress!();
    await atItem(2);
    alert.mockRestore();
  });

  it("does not ask when nothing unsaved is typed", async () => {
    const { Alert } = await import("react-native");
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    await makeHarness();
    render(<AreaCount />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await atItem(2);
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});

describe("review and submit", () => {
  async function countBoth() {
    const h = await makeHarness();
    render(<AreaCount />);
    key("Zero, none here"); // Shiraz is shared: a zero is a count
    fireEvent.click(saveButton());
    await atItem(2);
    type("3");
    fireEvent.click(saveButton());
    await screen.findByText("Review Bar");
    return h;
  }

  it("lists every item and holds Submit until the counts have reached the server", async () => {
    const { outbox } = await countBoth();
    const submit = screen.getByRole("button", { name: "Submit area" });
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("2 counts are still waiting to send.")).toBeTruthy();
    await outbox.drain();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit area" }).getAttribute("aria-disabled")).not.toBe("true"));
  });

  it("flags a shared item with no count and says to enter 0 if none", async () => {
    await makeHarness();
    render(<AreaCount />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" })); // skip Shiraz (shared)
    await atItem(2);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await screen.findByText("Review Bar");
    expect(screen.getByText("Not counted here. Also in Stock Room: enter 0 if none.")).toBeTruthy();
    expect(screen.getByText("Enter a count (0 if none) for 1 shared item.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit area" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("submits with the claim revision and goes back to the areas list", async () => {
    const { outbox, api } = await countBoth();
    await outbox.drain();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit area" }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Submit area" }));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith("/"));
    expect(api.submitArea).toHaveBeenCalledWith("S1", "Bar", 2);
  });

  it("shows the server's message when it says shared items are still missing", async () => {
    const missing = [{ ingredientId: "i1", ingredientName: "Shiraz", areaNames: ["Stock Room"] }];
    const { outbox } = await (async () => {
      const h = await makeHarness({ api: { submitArea: vi.fn(async () => ({ ok: false as const, missing, message: "Count these items in Bar before submitting: Shiraz" })) } });
      render(<AreaCount />);
      key("Zero, none here");
      fireEvent.click(saveButton());
      await atItem(2);
      type("3");
      fireEvent.click(saveButton());
      await screen.findByText("Review Bar");
      return h;
    })();
    await outbox.drain();
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit area" }).getAttribute("aria-disabled")).not.toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Submit area" }));
    await screen.findByText("Count these items in Bar before submitting: Shiraz");
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("a review row jumps back to that item", async () => {
    await countBoth();
    const row = screen.getByRole("button", { name: /^Shiraz:/ });
    fireEvent.click(row);
    await atItem(1);
    expect(screen.getByLabelText("Shiraz, kg, 0")).toBeTruthy();
  });
});
