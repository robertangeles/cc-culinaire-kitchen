import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eas = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8")) as { build: Record<string, { developmentClient?: boolean; distribution?: string; env?: Record<string, string>; android?: { buildType?: string } }> };

describe("EAS build profiles", () => {
  it("development is a dev client an internal tester can install, as an APK", () => {
    expect(eas.build.development).toMatchObject({ developmentClient: true, distribution: "internal", android: { buildType: "apk" } });
  });

  it("preview is a release-style build for internal testers (a pilot chef gets this), as an APK", () => {
    expect(eas.build.preview.developmentClient).toBeFalsy();
    expect(eas.build.preview).toMatchObject({ distribution: "internal", android: { buildType: "apk" } });
  });

  it("production is a store bundle", () => {
    expect(eas.build.production.android?.buildType).toBe("app-bundle");
  });

  it("no profile bakes a server address into the build: it is set per build, so a test build can never silently point at production", () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(profile.env?.EXPO_PUBLIC_API_URL, `profile ${name}`).toBeUndefined();
    }
  });
});
