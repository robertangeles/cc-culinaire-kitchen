import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
type Profile = { developmentClient?: boolean; distribution?: string; channel?: string; environment?: string; autoIncrement?: boolean; env?: Record<string, string>; android?: { buildType?: string } };
const eas = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8")) as { cli: { appVersionSource?: string }; build: Record<string, Profile>; submit?: Record<string, { android?: { track?: string } }> };
const app = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8")).expo as Record<string, any>;
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };

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

  it("the Bench is on in the development and preview builds and not in production, a store build, until the server has report and block", () => {
    expect(eas.build.development.env?.EXPO_PUBLIC_BENCH).toBe("on");
    expect(eas.build.preview.env?.EXPO_PUBLIC_BENCH).toBe("on");
    expect(eas.build.production.env?.EXPO_PUBLIC_BENCH).not.toBe("on");
  });

  it("no profile bakes a server address into the build: it is set per build, so a test build can never silently point at production", () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(profile.env?.EXPO_PUBLIC_API_URL, `profile ${name}`).toBeUndefined();
    }
  });
});

describe("app identity (both stores)", () => {
  it("is one app with the same id on iOS and Android, and runs on iPad", () => {
    expect(app.ios.bundleIdentifier).toBe("com.culinairekitchen.chef");
    expect(app.android.package).toBe("com.culinairekitchen.chef");
    expect(app.ios.supportsTablet).toBe(true);
  });

  it("has a plain semantic version (the server's update rule compares it) and leaves build numbers to EAS", () => {
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.ios.buildNumber).toBeUndefined();
    expect(app.android.versionCode).toBeUndefined();
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.preview.autoIncrement).toBe(true);
    expect(eas.build.production.autoIncrement).toBe(true);
  });

  it("declares that it only uses the standard HTTPS encryption, so no build stops at the export-compliance question", () => {
    expect(app.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("asks for no permission nothing uses yet (camera, location and the rest arrive with their feature, with their own words)", () => {
    expect(Object.keys(app.ios.infoPlist).filter((k) => k.endsWith("UsageDescription"))).toEqual([]);
    expect(app.android.permissions ?? []).toEqual([]);
  });

  it("asks for photos and the camera in its own words for the profile picture, and never for the microphone", () => {
    const picker = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-image-picker");
    expect(picker[1].photosPermission).toMatch(/profile picture/);
    expect(picker[1].cameraPermission).toMatch(/profile picture/);
    expect(picker[1].microphonePermission).toBe(false);
    expect(app.plugins.some((p: unknown) => Array.isArray(p) && p[0] === "expo-notifications")).toBe(true);
  });

  it("says in its own words why it uses Face ID for the app lock (iOS refuses Face ID without it)", () => {
    expect(pkg.dependencies["expo-local-authentication"]).toBeTruthy();
    const lock = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-local-authentication");
    expect(lock[1].faceIDPermission).toMatch(/CulinAIre Kitchen uses Face ID/);
  });

  it("has real icons and splash from the brand art, in the paper colour (not Expo's blue template)", () => {
    for (const f of [app.icon, app.android.adaptiveIcon.foregroundImage, app.android.adaptiveIcon.backgroundImage, app.android.adaptiveIcon.monochromeImage]) {
      expect(existsSync(resolve(root, f)), f).toBe(true);
    }
    expect(app.android.adaptiveIcon.backgroundColor).toBe("#F3EFE4");
    const splash = app.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-splash-screen");
    expect(splash[1]).toMatchObject({ image: "./assets/splash-icon.png", backgroundColor: "#F3EFE4", dark: { backgroundColor: "#101418" } });
    expect(existsSync(resolve(root, splash[1].image))).toBe(true);
  });
});

describe("over-the-air updates", () => {
  it("is installed, and a JS update only ever reaches a build with the same app version (the version the server's update rule reads)", () => {
    expect(pkg.dependencies["expo-updates"]).toBeTruthy();
    expect(app.runtimeVersion).toEqual({ policy: "appVersion" });
  });

  it("goes to one channel per build profile, so an internal test build never receives a production update", () => {
    const channels = Object.entries(eas.build).map(([name, p]) => [name, p.channel]);
    expect(channels).toEqual([["development", "development"], ["preview", "preview"], ["production", "production"]]);
  });

  it("takes each profile's server address from the EAS environment of that name, never from a file in the repo", () => {
    for (const [name, p] of Object.entries(eas.build)) expect(p.environment, name).toBe(name);
  });
});

describe("store submission", () => {
  it("production is a store build; internal testing goes to the Play internal track", () => {
    expect(eas.build.production.distribution ?? "store").toBe("store");
    expect(eas.submit?.internal?.android?.track).toBe("internal");
    expect(eas.submit?.production?.android?.track).toBe("production");
  });
});

describe("the app lock on Android", () => {
  const activity = "class MainActivity : ReactActivity() {\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(null)\n  }\n}\n";

  it("keeps the app's picture out of the app switcher, which Android takes before the app can cover itself", async () => {
    const { default: appConfig, hideFromRecents } = await import("../app.config");
    expect(hideFromRecents(activity)).toMatch(/super\.onCreate\(null\)\n.*VERSION_CODES\.TIRAMISU\) \{\n +setRecentsScreenshotEnabled\(false\)/);
    // Android's blank page in its place is the paper colour.
    expect(hideFromRecents(activity)).toContain("setBackgroundColor(0xFFF3EFE4.toInt())");
    expect(hideFromRecents(hideFromRecents(activity))).toBe(hideFromRecents(activity));
    const config = appConfig({ config: app as never, projectRoot: root, staticConfigPath: null, packageJsonPath: null }) as { mods?: { android?: { mainActivity?: unknown } } };
    expect(config.mods?.android?.mainActivity).toBeTruthy();
  });

  it("stops the build rather than leaving it out when Expo's template changes", async () => {
    const { hideFromRecents } = await import("../app.config");
    expect(() => hideFromRecents("class MainActivity")).toThrow(/MainActivity/);
  });
});

describe("app config for iPhone and iPad", () => {
  const appJson = JSON.parse(readFileSync(resolve(root, "app.json"), "utf8")).expo as { ios: { supportsTablet: boolean }; plugins: unknown[] };
  const build = async (scheme?: string) => {
    const previous = process.env.GOOGLE_IOS_URL_SCHEME;
    if (scheme === undefined) delete process.env.GOOGLE_IOS_URL_SCHEME;
    else process.env.GOOGLE_IOS_URL_SCHEME = scheme;
    try {
      const { default: appConfig } = await import("../app.config");
      return appConfig({ config: appJson as never, projectRoot: root, staticConfigPath: null, packageJsonPath: null });
    } finally {
      if (previous === undefined) delete process.env.GOOGLE_IOS_URL_SCHEME;
      else process.env.GOOGLE_IOS_URL_SCHEME = previous;
    }
  };

  it("keeps the iPad supported and enables Sign in with Apple (the capability that App Store rule 4.8 asks for beside Google)", async () => {
    const config = await build();
    expect(config.ios?.supportsTablet).toBe(true);
    expect(config.plugins).toContain("expo-apple-authentication");
  });

  it("registers the Google iOS URL scheme from the build environment, and leaves the Google plugin alone when it is not set", async () => {
    expect((await build()).plugins).toContain("@react-native-google-signin/google-signin");
    const withScheme = await build("com.googleusercontent.apps.123-abc");
    expect(withScheme.plugins).toContainEqual(["@react-native-google-signin/google-signin", { iosUrlScheme: "com.googleusercontent.apps.123-abc" }]);
    expect(withScheme.plugins).not.toContain("@react-native-google-signin/google-signin");
  });
});
