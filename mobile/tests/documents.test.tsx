// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { Alert, Linking } from "react-native";
import type { MyDocument } from "@culinaire/shared/schemas/compliance";
import { ApiError } from "../src/api/client";
import type { ComplianceApi } from "../src/compliance/complianceApi";
import { createDocumentStore } from "../src/compliance/documentStore";
import { DocumentsContextProvider } from "../src/compliance/DocumentsProvider";
import { routerMock, searchParams, sessionState } from "../testing/mocks";

const picker = vi.hoisted(() => ({ requestCameraPermissionsAsync: vi.fn(), launchCameraAsync: vi.fn(), launchImageLibraryAsync: vi.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" } }));
vi.mock("expo-image-picker", () => picker);
/** The phone's files: the cleaned photo, null when it is not one the server takes. */
const files = vi.hoisted(() => ({ takePhoto: vi.fn() }));
vi.mock("../src/photos/photoFiles", () => files);
vi.mock("../src/runtime/appContext", async () => {
  const { sessionMock, sessionState, authApiMock } = await import("../testing/mocks");
  return { session: sessionMock, authApi: authApiMock, client: {}, googleEnabled: false, appleEnabled: false, useSession: () => sessionState.current };
});

import Documents from "../app/(app)/(documents)/index";
import DocumentScreen from "../app/(app)/(documents)/document";
import DocumentNew from "../app/(app)/(documents)/document-new";
import DocumentEdit from "../app/(app)/(documents)/document-edit";

const NOW = Date.parse("2026-11-26T00:00:00Z");
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch", ianaTimezone: "Australia/Melbourne" };
const doc = (over: Partial<MyDocument> = {}): MyDocument => ({ complianceDocumentId: "d1", documentType: "RSA", verificationStatus: "Pending", documentNumber: "RSA-1", issueDate: "2024-07-08", expiryDate: "2027-07-08", issuingJurisdiction: "VIC", uploadedAt: "2026-11-25T00:00:00Z", rejectionReason: null, storagePublicId: "p1", storageFormat: "jpg", ...over });
const api = { mine: vi.fn(), upload: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), nudge: vi.fn(), viewUrl: vi.fn(), readImage: vi.fn() } satisfies Record<keyof ComplianceApi, ReturnType<typeof vi.fn>>;

const server = { docs: [] as MyDocument[] };
async function open(ui: ReactNode, docs: MyDocument[] = []) {
  server.docs = docs;
  api.mine.mockImplementation(async () => server.docs);
  const store = createDocumentStore(api as unknown as ComplianceApi);
  await store.refresh();
  return { store, ...render(<DocumentsContextProvider value={store}>{ui}</DocumentsContextProvider>) };
}
const answer = (label: string) => vi.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => buttons?.find((b) => b.text === label)?.onPress?.());
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const pick = (label: string) => fireEvent.click(screen.getByRole("radio", { name: label }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const CLEAN = { bytes: new Uint8Array([0xff, 0xd8]), mimeType: "image/jpeg" };
const photo = (over: object = {}) => ({ canceled: false, assets: [{ uri: "file:///c.jpg", mimeType: "image/jpeg", ...over }] });

beforeEach(() => {
  sessionState.current = { state: { phase: "ready", user: { userId: 1, userName: "Cook", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["compliance:read-own"] }, location: main, locations: [main] }, busy: false };
  searchParams.current = {};
  Object.values(api).forEach((f) => f.mockReset());
  picker.requestCameraPermissionsAsync.mockReset().mockResolvedValue({ granted: true });
  picker.launchCameraAsync.mockReset().mockResolvedValue(photo());
  picker.launchImageLibraryAsync.mockReset().mockResolvedValue(photo());
  files.takePhoto.mockReset().mockResolvedValue(CLEAN);
  api.upload.mockResolvedValue({ storagePublicId: "p9", storageFormat: "jpg", ocr: {} });
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.restoreAllMocks();
});

describe("my documents", () => {
  it("puts what needs me first, with what to fix, and opens one", async () => {
    await open(<Documents />, [doc({ complianceDocumentId: "v", documentType: "Police Check", verificationStatus: "Verified" }), doc({ verificationStatus: "Rejected", rejectionReason: "The photo is blurred" }), doc({ complianceDocumentId: "p", documentType: "Food Handler", expiryDate: null })]);
    expect(screen.getAllByText(/^(Needs you|With your manager|On record)$/).map((n) => n.textContent)).toEqual(expect.arrayContaining(["Needs you", "With your manager", "On record"]));
    expect(screen.getByText("What to fix: The photo is blurred")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Food Handler, With your manager, No expiry date" })).toBeTruthy();
    press("RSA, Not accepted, Expires 8 July 2027");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/document", params: { id: "d1" } });
  });

  it("starts empty with a card, and says when documents are off or out of reach", async () => {
    const t = await open(<Documents />);
    expect(screen.getByText("Add your first certificate")).toBeTruthy();
    press("Add a certificate");
    expect(routerMock.push).toHaveBeenCalledWith("/document-new");
    api.mine.mockRejectedValue(new ApiError("not_found", undefined, 404));
    await t.store.refresh();
    expect(await screen.findByText("Documents aren't in use here")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add a certificate" })).toBeNull();
    cleanup();
    const u = await open(<Documents />, [doc()]);
    api.mine.mockRejectedValue(new ApiError("network"));
    await u.store.refresh();
    expect(await screen.findByText(/may be out of date/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^RSA/ })).toBeTruthy();
  });
});

describe("one document", () => {
  beforeEach(() => void (searchParams.current = { id: "d1" }));

  it("shows its photo only when asked, read into memory", async () => {
    await open(<DocumentScreen />, [doc()]);
    expect(api.viewUrl).not.toHaveBeenCalled();
    expect(screen.getByText("With your manager since 25 November 2026.")).toBeTruthy();
    api.viewUrl.mockResolvedValue("https://files.test/x");
    api.readImage.mockResolvedValue("data:image/jpeg;base64,AAAA");
    press("Show the photo");
    expect(await screen.findByLabelText("Photo of your RSA")).toBeTruthy();
    expect(api.readImage).toHaveBeenCalledWith("https://files.test/x");
  });

  it("opens a PDF in the browser, and says when nothing can", async () => {
    await open(<DocumentScreen />, [doc({ storageFormat: "pdf" })]);
    api.viewUrl.mockResolvedValue("https://files.test/x.pdf");
    const openURL = vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("none"));
    press("Open the file in your browser");
    expect(await screen.findByText(/No app on this phone can open the file/)).toBeTruthy();
    expect(openURL).toHaveBeenCalledWith("https://files.test/x.pdf");
  });

  it("offers change and delete only until a manager has signed it off", async () => {
    await open(<DocumentScreen />, [doc({ verificationStatus: "Verified" })]);
    for (const name of ["Change the details", "Delete", "Remind your manager"]) expect(screen.queryByRole("button", { name })).toBeNull();
    cleanup();
    await open(<DocumentScreen />, [doc({ verificationStatus: "Rejected", rejectionReason: "Blurred" })]);
    expect(screen.getByText("What to fix")).toBeTruthy();
    press("Correct the details");
    expect(routerMock.push).toHaveBeenCalledWith({ pathname: "/document-edit", params: { id: "d1" } });
  });

  it("asks before deleting, and keeps the page with the server's words when it refuses", async () => {
    await open(<DocumentScreen />, [doc()]);
    answer("Delete");
    api.remove.mockRejectedValueOnce(new ApiError("conflict", "Can't delete a document that is verified", 409));
    press("Delete");
    expect(await screen.findByText("Can't delete a document that is verified")).toBeTruthy();
    api.remove.mockImplementationOnce(async () => void (server.docs = []));
    press("Delete");
    await vi.waitFor(() => expect(routerMock.back).toHaveBeenCalled());
  });

  it("reminds the manager after two days, once", async () => {
    await open(<DocumentScreen />, [doc({ uploadedAt: "2026-11-20T00:00:00Z" })]);
    press("Remind your manager");
    expect(await screen.findByText("Reminder sent.")).toBeTruthy();
    expect(api.nudge).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Remind your manager" })).toBeNull();
  });

  it("says so when a notification names a colleague's document", async () => {
    searchParams.current = { id: "d9", from: "link" };
    await open(<DocumentScreen />, [doc()]);
    expect(screen.getByText("Not one of your documents")).toBeTruthy();
    press("Back to my documents");
    expect(routerMock.dismissTo).toHaveBeenCalledWith("/(app)/(documents)");
  });
});

describe("adding a certificate", () => {
  it("takes a photo, fills in what was read off it, and sends it for review", async () => {
    await open(<DocumentNew />);
    expect(screen.getByRole("button", { name: "Send for review" })).toHaveProperty("disabled", true);
    pick("RSA");
    api.upload.mockResolvedValueOnce({ storagePublicId: "p9", storageFormat: "jpg", ocr: { documentNumber: "V123", expiryDate: "2028-03-01" } });
    press("Take a photo");
    expect(await screen.findByText("✓ Photo added")).toBeTruthy();
    expect(screen.getAllByText("Read from the photo. Check it.")).toHaveLength(2);
    expect((screen.getByLabelText("Expires") as HTMLInputElement).value).toBe("01/03/2028");
    type("Issued", "08072026");
    pick("VIC");
    api.create.mockImplementation(async () => void (server.docs = [doc({ storagePublicId: "p9" })]));
    press("Send for review");
    expect(await screen.findByText("Sent for review")).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith({ documentType: "RSA", engagementType: "employee", documentNumber: "V123", issueDate: "2026-07-08", expiryDate: "2028-03-01", issuingJurisdiction: "VIC", storagePublicId: "p9", storageFormat: "jpg" });
  });

  it("says why the camera is needed before it asks, and what to do when it is refused", async () => {
    await open(<DocumentNew />);
    expect(screen.getByText(/The camera is used only for this photo/)).toBeTruthy();
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    press("Take a photo");
    expect(await screen.findByText(/The camera isn't allowed/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open settings" })).toBeTruthy();
    expect(api.upload).not.toHaveBeenCalled();
    press("Choose a photo");
    expect(await screen.findByText("✓ Photo added")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open settings" })).toBeNull();
  });

  it("refuses a photo that is too big or in another format before sending it, and says nothing when the picker is closed", async () => {
    await open(<DocumentNew />);
    files.takePhoto.mockResolvedValueOnce({ bytes: { length: 11 * 1024 * 1024 }, mimeType: "image/jpeg" });
    press("Choose a photo");
    expect(await screen.findByText(/over 10 MB/)).toBeTruthy();
    files.takePhoto.mockResolvedValueOnce(null); // an iPhone's HEIC
    press("Choose a photo");
    expect(await screen.findByText(/format can't be used/)).toBeTruthy();
    picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    press("Choose a photo");
    await Promise.resolve();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("sends only the cleaned bytes, never the file, and nothing it could not clean", async () => {
    await open(<DocumentNew />);
    press("Take a photo");
    await screen.findByText("✓ Photo added");
    expect(files.takePhoto).toHaveBeenCalledWith("file:///c.jpg");
    expect(api.upload).toHaveBeenCalledWith(CLEAN);
    api.upload.mockClear();
    for (const broken of [async () => null, async () => { throw new Error("cannot read"); }]) {
      files.takePhoto.mockImplementationOnce(broken);
      press("Take it again");
      expect(await screen.findByText(/format can't be used/)).toBeTruthy();
    }
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("keeps the photo on the form after a lost upload and sends the same one again", async () => {
    await open(<DocumentNew />);
    pick("RSA");
    api.upload.mockRejectedValueOnce(new ApiError("network"));
    press("Take a photo");
    expect(await screen.findByText(/The photo wasn't sent: no connection/)).toBeTruthy();
    press("Send the photo again");
    expect(await screen.findByText("✓ Photo added")).toBeTruthy();
    expect(api.upload).toHaveBeenNthCalledWith(2, CLEAN);
  });

  it("never makes a second record when the answer to Send was lost", async () => {
    await open(<DocumentNew />);
    pick("RSA");
    press("Choose a photo");
    await screen.findByText("✓ Photo added");
    api.create.mockImplementationOnce(async () => {
      server.docs = [doc({ storagePublicId: "p9" })];
      throw new ApiError("timeout");
    });
    press("Send for review");
    expect(await screen.findByText("Sent for review")).toBeTruthy();
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("keeps everything typed when the server refuses", async () => {
    await open(<DocumentNew />);
    pick("Other");
    type("Name of the document", "rsa");
    expect(screen.getByText('Did you mean "RSA"? Pick it from the list instead.')).toBeTruthy();
    type("Name of the document", "First Aid");
    press("Choose a photo");
    await screen.findByText("✓ Photo added");
    type("Certificate number", "FA1");
    type("Expires", "0101");
    press("Send for review");
    expect(await screen.findByText(/Enter the expiry date/)).toBeTruthy();
    type("Expires", "");
    api.create.mockRejectedValueOnce(new ApiError("conflict", "You've already uploaded a First Aid with this document number", 409));
    press("Send for review");
    expect(await screen.findByText("You've already uploaded a First Aid with this document number")).toBeTruthy();
    expect((screen.getByLabelText("Certificate number") as HTMLInputElement).value).toBe("FA1");
  });
});

describe("correcting a certificate", () => {
  beforeEach(() => void (searchParams.current = { id: "d1" }));

  it("sends a rejected one back to the manager", async () => {
    await open(<DocumentEdit />, [doc({ verificationStatus: "Rejected" })]);
    expect((screen.getByLabelText("Issued") as HTMLInputElement).value).toBe("08/07/2024");
    type("Expires", "01012029");
    pick("Not sure");
    press("Send for review again");
    await vi.waitFor(() => expect(routerMock.back).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith("d1", { documentNumber: "RSA-1", issueDate: "2024-07-08", expiryDate: "2029-01-01", issuingJurisdiction: null });
  });

  it("cannot change one a manager has signed off", async () => {
    await open(<DocumentEdit />, [doc({ verificationStatus: "Verified" })]);
    expect(screen.getByText("This can't be changed")).toBeTruthy();
  });

  it("keeps what was typed with no signal", async () => {
    await open(<DocumentEdit />, [doc()]);
    api.update.mockRejectedValue(new ApiError("network"));
    type("Certificate number", "NEW");
    press("Save");
    expect(await screen.findByText("Saving needs a connection. Try again with a signal.")).toBeTruthy();
    expect((screen.getByLabelText("Certificate number") as HTMLInputElement).value).toBe("NEW");
  });
});

describe("tablet width", () => {
  it.each([["my documents", Documents], ["a document", DocumentScreen], ["the add form", DocumentNew], ["the change form", DocumentEdit]] as const)("keeps %s in one column of 560 dp at iPad width", async (_name, Page) => {
    window.innerWidth = 820;
    window.innerHeight = 1180;
    searchParams.current = { id: "d1", shiftId: "s1" };
    const { container } = await open(<Page />, [doc()]);
    await vi.waitFor(() => expect([...container.querySelectorAll("div")].some((d) => getComputedStyle(d).maxWidth === "560px")).toBe(true));
  });
});
