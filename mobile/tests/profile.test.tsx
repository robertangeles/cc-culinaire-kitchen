// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { Linking } from "react-native";
import { ApiError } from "../src/api/client";
import { routerMock } from "../testing/mocks";

// Profile and account: the real screens through react-native-web; only the server calls and the photo picker are faked.
const mocks = vi.hoisted(() => ({
  state: { current: { state: { phase: "signedOut" } as unknown, busy: false } },
  session: { signOut: vi.fn(), changeLocation: vi.fn(), refreshUser: vi.fn(), joinOrganisation: vi.fn(), joinLocation: vi.fn() },
  accountApi: {
    facts: vi.fn(),
    details: vi.fn(),
    saveDetails: vi.fn(),
    uploadAvatar: vi.fn(),
    changePassword: vi.fn(),
    mfaSetup: vi.fn(),
    mfaEnable: vi.fn(),
    mfaDisable: vi.fn(),
    kitchenProfile: vi.fn(),
    saveKitchenProfile: vi.fn(),
    personalisationOptions: vi.fn(),
  },
  authApi: { locationContext: vi.fn() },
  pickImage: vi.fn(),
}));
vi.mock("../src/runtime/appContext", () => ({ session: mocks.session, accountApi: mocks.accountApi, authApi: mocks.authApi, appleEnabled: false, useSession: () => mocks.state.current }));
vi.mock("../src/runtime/appOutbox", () => ({ outbox: { open: async () => [], subscribe: () => () => {} }, runner: { kick: vi.fn() } }));
vi.mock("../src/profile/pickImage", () => ({ pickImage: mocks.pickImage }));

import Account from "../app/(app)/account";
import Profile from "../app/profile";
import ChangePassword from "../app/change-password";
import TwoStep from "../app/two-step";
import KitchenProfile from "../app/kitchen-profile";
import FirstRun from "../app/first-run";

const chef = { userId: 1, userName: "Chef", userEmail: "c@x.test", mfaEnabled: false, roles: [], permissions: ["inventory:count"], userPhotoPath: null };
const main = { storeLocationId: "L1", organisationId: 1, locationName: "Main Kitchen", classification: "branch" };
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const blank = { userName: "Chef", userBio: "", userAddressLine1: "", userAddressLine2: "", userSuburb: "", userState: "", userCountry: "", userPostcode: "", userFacebook: "", userInstagram: "", userTiktok: "", userPinterest: "", userLinkedin: "" };
const facts = (over: object = {}) => ({ hasPassword: true, hasApple: false, mfaEnabled: false, email: "c@x.test", ...over });

beforeEach(() => {
  mocks.state.current = { state: { phase: "ready", user: chef, location: main, locations: [main] }, busy: false };
  for (const fn of [...Object.values(mocks.accountApi), ...Object.values(mocks.session), mocks.authApi.locationContext, mocks.pickImage]) fn.mockReset();
  mocks.accountApi.details.mockResolvedValue({ ...blank, userEmail: "c@x.test", userPhotoPath: null });
  mocks.accountApi.facts.mockResolvedValue(facts());
  routerMock.push.mockClear();
});
afterEach(cleanup);

describe("the account hub", () => {
  it("opens each profile and security screen", () => {
    render(<Account />);
    for (const [label, href] of [["My details", "/profile"], ["Kitchen profile", "/kitchen-profile"], ["Password", "/change-password"], ["Two-step verification", "/two-step"], ["Notifications", "/notification-settings"]]) {
      click(label);
      expect(routerMock.push).toHaveBeenLastCalledWith(href);
    }
  });

  it("shows the picture, or the first letter when there is none, and keeps Delete my account", () => {
    render(<Account />);
    expect(screen.getByLabelText("No profile picture")).toBeTruthy();
    click("Delete my account");
    expect(routerMock.push).toHaveBeenLastCalledWith("/delete-account");
  });
});

describe("my details", () => {
  it("saves every field, an emptied one as blank, then reads the person again", async () => {
    mocks.accountApi.details.mockResolvedValue({ ...blank, userSuburb: "Fitzroy", userEmail: "c@x.test", userPhotoPath: null });
    mocks.accountApi.saveDetails.mockResolvedValue(undefined);
    render(<Profile />);
    await screen.findByDisplayValue("Fitzroy");
    fill("Name", "Chef Rob ");
    fill("Suburb or city", "");
    fill("Instagram", "https://instagram.com/chefrob");
    click("Save");
    await waitFor(() => expect(mocks.accountApi.saveDetails).toHaveBeenCalledWith({ ...blank, userName: "Chef Rob", userInstagram: "https://instagram.com/chefrob" }));
    expect(mocks.session.refreshUser).toHaveBeenCalled();
    expect(await screen.findByText("Your details are saved.")).toBeTruthy();
  });

  it("will not save an empty name", async () => {
    render(<Profile />);
    await screen.findByDisplayValue("Chef");
    fill("Name", "  ");
    expect(screen.getByText("Your name can't be empty.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("uploads a chosen photo and shows the new picture", async () => {
    mocks.pickImage.mockResolvedValue({ kind: "picked", image: { uri: "file:///a.jpg", mimeType: "image/jpeg" } });
    mocks.accountApi.uploadAvatar.mockResolvedValue("https://img/a.jpg");
    render(<Profile />);
    await screen.findByDisplayValue("Chef");
    click("Choose photo");
    await waitFor(() => expect(mocks.accountApi.uploadAvatar).toHaveBeenCalledWith({ uri: "file:///a.jpg", mimeType: "image/jpeg" }));
    expect(mocks.pickImage).toHaveBeenCalledWith("library");
    expect(mocks.session.refreshUser).toHaveBeenCalled();
    expect(await screen.findByText("Picture updated.")).toBeTruthy();
  });

  it("takes a photo with the camera, and explains a refused camera or a format the server can't take", async () => {
    mocks.pickImage.mockResolvedValueOnce({ kind: "denied" }).mockResolvedValueOnce({ kind: "unsupported" }).mockResolvedValueOnce({ kind: "cancelled" });
    render(<Profile />);
    await screen.findByDisplayValue("Chef");
    click("Take photo");
    expect(await screen.findByText(/camera isn't allowed/)).toBeTruthy();
    expect(mocks.pickImage).toHaveBeenCalledWith("camera");
    click("Choose photo");
    expect(await screen.findByText(/format can't be used/)).toBeTruthy();
    click("Choose photo");
    await waitFor(() => expect(mocks.pickImage).toHaveBeenCalledTimes(3));
    expect(mocks.accountApi.uploadAvatar).not.toHaveBeenCalled();
  });

  it("shows the server's words for a refused upload", async () => {
    mocks.pickImage.mockResolvedValue({ kind: "picked", image: { uri: "file:///a.png", mimeType: "image/png" } });
    mocks.accountApi.uploadAvatar.mockRejectedValue(new ApiError("bad_request", "File too large. Maximum size is 2 MB.", 400));
    render(<Profile />);
    await screen.findByDisplayValue("Chef");
    click("Choose photo");
    expect(await screen.findByText("File too large. Maximum size is 2 MB.")).toBeTruthy();
  });
});

describe("change password", () => {
  it("changes it with the current one and says this phone stays signed in", async () => {
    mocks.accountApi.changePassword.mockResolvedValue(undefined);
    render(<ChangePassword />);
    await screen.findByLabelText("Current password");
    fill("Current password", "old-pass");
    fill("New password", "short");
    expect(screen.getByRole("button", { name: "Change password" }).getAttribute("aria-disabled")).toBe("true");
    fill("New password", "a-long-new-one");
    click("Change password");
    await waitFor(() => expect(mocks.accountApi.changePassword).toHaveBeenCalledWith("old-pass", "a-long-new-one"));
    expect(await screen.findByText(/You're still signed in here/)).toBeTruthy();
  });

  it("shows the server's sentence for a wrong current password", async () => {
    mocks.accountApi.changePassword.mockRejectedValue(new ApiError("bad_request", "Current password is incorrect.", 400));
    render(<ChangePassword />);
    await screen.findByLabelText("Current password");
    fill("Current password", "wrong");
    fill("New password", "a-long-new-one");
    click("Change password");
    expect(await screen.findByText("Current password is incorrect.")).toBeTruthy();
  });

  it("explains that a Google or Apple account has no password", async () => {
    mocks.accountApi.facts.mockResolvedValue(facts({ hasPassword: false }));
    render(<ChangePassword />);
    expect(await screen.findByText(/has no password to change/)).toBeTruthy();
  });
});

describe("two-step verification", () => {
  it("sets it up: password, then the key (opens the authenticator app), then the first code", async () => {
    mocks.accountApi.mfaSetup.mockResolvedValue({ secret: "JBSWY3DPEHPK3PXP", qrCodeDataUrl: "data:image/png;base64,iVBOR" });
    mocks.accountApi.mfaEnable.mockResolvedValue(undefined);
    const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    render(<TwoStep />);
    await screen.findByText("Off");
    click("Set up");
    fill("Your password", "pw");
    click("Continue");
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(mocks.accountApi.mfaSetup).toHaveBeenCalledWith({ password: "pw", mfaCode: undefined });
    expect(screen.getByLabelText("QR code for your authenticator app")).toBeTruthy();
    click("Open in authenticator app");
    expect(openURL).toHaveBeenCalledWith("otpauth://totp/CulinAIre%20Kitchen%3Ac%40x.test?secret=JBSWY3DPEHPK3PXP&issuer=CulinAIre%20Kitchen");
    fill("6-digit code", "12a3456");
    click("Turn on");
    await waitFor(() => expect(mocks.accountApi.mfaEnable).toHaveBeenCalledWith("123456"));
    expect(await screen.findByText(/Two-step verification is on/)).toBeTruthy();
    expect(screen.getByText("On for your account")).toBeTruthy();
    expect(mocks.session.refreshUser).toHaveBeenCalled();
  });

  it("starts set-up straight away for an account with no password, and offers Sign out when the sign-in is too old", async () => {
    mocks.accountApi.facts.mockResolvedValue(facts({ hasPassword: false }));
    mocks.accountApi.mfaSetup.mockRejectedValue(new ApiError("forbidden", "x", 403, {}, "RECENT_SIGN_IN_REQUIRED"));
    render(<TwoStep />);
    await screen.findByText("Off");
    click("Set up");
    expect(await screen.findByText(/sign out, sign back in/)).toBeTruthy();
    click("Sign out");
    expect(mocks.session.signOut).toHaveBeenCalled();
  });

  it("turns it off with the password and a current code", async () => {
    mocks.accountApi.facts.mockResolvedValue(facts({ mfaEnabled: true }));
    mocks.accountApi.mfaDisable.mockRejectedValueOnce(new ApiError("forbidden", "x", 403, {}, "INVALID_MFA_CODE")).mockResolvedValueOnce(undefined);
    render(<TwoStep />);
    await screen.findByText("On for your account");
    click("Turn off");
    fill("Your password", "pw");
    fill("Authenticator code", "111111");
    click("Turn off two-step verification");
    expect(await screen.findByText("That authenticator code isn't valid.")).toBeTruthy();
    fill("Authenticator code", "222222");
    click("Turn off two-step verification");
    await waitFor(() => expect(mocks.accountApi.mfaDisable).toHaveBeenLastCalledWith({ password: "pw", mfaCode: "222222" }));
    expect(await screen.findByText("Two-step verification is off.")).toBeTruthy();
  });
});

const options = {
  skill_level: [
    { optionValue: "line_cook", optionLabel: "Line cook", optionDescription: "Works a station" },
    { optionValue: "head_chef", optionLabel: "Head chef", optionDescription: null },
  ],
  cuisine: [{ optionValue: "italian", optionLabel: "Italian", optionDescription: null }],
  dietary: [],
  equipment: [],
};
const kitchen = { skillLevel: "line_cook", cuisinePreferences: [], dietaryRestrictions: [], kitchenEquipment: [], servingsDefault: 4, restaurantName: "", establishmentType: "", cuisineIdentity: "", targetDiner: "", pricePoint: "", restaurantVoice: "", sourcingValues: [], platingStyle: "", kitchenConstraints: [], menuNeeds: [] };

describe("kitchen profile", () => {
  beforeEach(() => {
    mocks.accountApi.kitchenProfile.mockResolvedValue(kitchen);
    mocks.accountApi.personalisationOptions.mockResolvedValue(options);
    mocks.accountApi.saveKitchenProfile.mockResolvedValue(undefined);
  });

  it("lets a cook set their skill level only, as on the web, and sends nothing else", async () => {
    mocks.authApi.locationContext.mockResolvedValue({ isOrgAdmin: false });
    render(<KitchenProfile />);
    fireEvent.click(await screen.findByRole("radio", { name: "Head chef" }));
    expect(screen.queryByText("Your restaurant")).toBeNull();
    click("Save");
    await waitFor(() => expect(mocks.accountApi.saveKitchenProfile).toHaveBeenCalledWith({ skillLevel: "head_chef" }));
    expect(await screen.findByText("Kitchen profile saved.")).toBeTruthy();
  });

  it("lets an organisation admin answer the kitchen, restaurant and menu questions", async () => {
    mocks.authApi.locationContext.mockResolvedValue({ isOrgAdmin: true });
    render(<KitchenProfile />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "Italian" }));
    fill("Restaurant or business name", "The Blue Knife");
    fireEvent.click(screen.getByRole("radio", { name: "Other" }));
    fill("Your type of establishment", "Night market");
    fill("Default servings", "0");
    expect(screen.getByText(/whole number from 1 to 100/)).toBeTruthy();
    fill("Default servings", "8");
    for (const need of ["New mains", "New desserts", "Staff meal ideas"]) fireEvent.click(screen.getByRole("checkbox", { name: need }));
    expect(screen.getByRole("checkbox", { name: "Seasonal specials" }).getAttribute("aria-disabled")).toBe("true");
    click("Save");
    await waitFor(() =>
      expect(mocks.accountApi.saveKitchenProfile).toHaveBeenCalledWith(
        expect.objectContaining({ cuisinePreferences: ["Italian"], restaurantName: "The Blue Knife", establishmentType: "Night market", servingsDefault: 8, menuNeeds: ["new_mains", "new_desserts", "staff_meals"] }),
      ),
    );
  });

  it("offers the server's skill levels when the admin-managed list is empty, and hides empty lists", async () => {
    mocks.authApi.locationContext.mockResolvedValue({ isOrgAdmin: true });
    mocks.accountApi.personalisationOptions.mockResolvedValue({ skill_level: [], cuisine: [], dietary: [], equipment: [] });
    render(<KitchenProfile />);
    fireEvent.click(await screen.findByRole("radio", { name: "Sous chef" }));
    expect(screen.queryByText(/Cuisine preferences/i)).toBeNull();
    click("Save");
    await waitFor(() => expect(mocks.accountApi.saveKitchenProfile).toHaveBeenCalledWith(expect.objectContaining({ skillLevel: "sous_chef" })));
  });

  it("loads again with Try again after a failed load", async () => {
    mocks.authApi.locationContext.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue({ isOrgAdmin: false });
    render(<KitchenProfile />);
    await screen.findByText("Try again");
    click("Try again");
    expect(await screen.findByRole("radio", { name: "Line cook" })).toBeTruthy();
  });

  it("says when the profile cannot be loaded", async () => {
    mocks.authApi.locationContext.mockRejectedValue(new ApiError("network"));
    render(<KitchenProfile />);
    expect(await screen.findByText(/Couldn't load your kitchen profile/)).toBeTruthy();
  });
});

describe("no location yet", () => {
  it("asks for the location key, explains what to do without one, and keeps delete and the legal pages reachable", () => {
    mocks.state.current = { state: { phase: "firstRun", user: chef, organisationId: 1 }, busy: false };
    render(<FirstRun />);
    expect(screen.getByText("Join your location")).toBeTruthy();
    expect(screen.getByText(/add you to a location directly/)).toBeTruthy();
    expect(screen.getByText("Signed in as c@x.test")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeTruthy();
    click("Delete my account");
    expect(routerMock.push).toHaveBeenLastCalledWith("/delete-account");
    fill("Location key", "KITCHEN-ABC");
    click("Join");
    expect(mocks.session.joinLocation).toHaveBeenCalledWith("KITCHEN-ABC");
  });
});
