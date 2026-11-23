import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// The phone's update screen links to these two listings; until the owner can set them here, no link ever shows.
const save = vi.fn();
vi.mock("../../hooks/useSiteSettings.js", () => ({
  useSiteSettings: () => ({
    settings: { mobile_min_app_version: "1.0.0", mobile_store_url_ios: "https://apps.apple.com/app/id1", mobile_store_url_android: "" },
    isLoading: false,
    isSaving: false,
    error: null,
    success: null,
    save,
    uploadFile: vi.fn(),
  }),
}));

import { SiteSettingsTab } from "./SiteSettingsTab.js";

beforeEach(() => save.mockReset());

describe("SiteSettingsTab phone app store links", () => {
  it("shows the saved links, one field per store", () => {
    render(<SiteSettingsTab />);
    expect((screen.getByLabelText("App Store link") as HTMLInputElement).value).toBe("https://apps.apple.com/app/id1");
    expect((screen.getByLabelText("Google Play link") as HTMLInputElement).value).toBe("");
  });

  it("saves them with the rest of the form", () => {
    render(<SiteSettingsTab />);
    fireEvent.change(screen.getByLabelText("Google Play link"), { target: { value: "https://play.google.com/store/apps/details?id=com.culinairekitchen.chef" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      mobile_store_url_ios: "https://apps.apple.com/app/id1",
      mobile_store_url_android: "https://play.google.com/store/apps/details?id=com.culinairekitchen.chef",
    }));
  });
});
