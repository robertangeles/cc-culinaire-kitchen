import type { ConfigContext, ExpoConfig } from "expo/config";
import { withMainActivity } from "expo/config-plugins";

const GOOGLE_PLUGIN = "@react-native-google-signin/google-signin";

const RECENTS_ANCHOR = "super.onCreate(null)";
/** What Android shows instead is a plain page in the task's own colour: the paper (`palettes.light.bg` in src/theme.ts), not white. */
const RECENTS_LINES = [
  "if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {",
  "  setRecentsScreenshotEnabled(false)",
  "  setTaskDescription(android.app.ActivityManager.TaskDescription.Builder().setBackgroundColor(0xFFF3EFE4.toInt()).build())",
  "}",
];

/**
 * Android 13 and later: no picture of the app in the app switcher, nor for a moment on the way back to it. Android takes that picture as the
 * app leaves, before the app lock's cover is drawn (iOS takes it after).
 */
export function hideFromRecents(mainActivity: string): string {
  if (mainActivity.includes("setRecentsScreenshotEnabled")) return mainActivity;
  if (!mainActivity.includes(RECENTS_ANCHOR)) throw new Error("MainActivity has no super.onCreate(null): update hideFromRecents in app.config.ts");
  return mainActivity.replace(RECENTS_ANCHOR, [RECENTS_ANCHOR, ...RECENTS_LINES].join("\n    "));
}

/**
 * app.json plus what is not a plain value: Google sign-in on iPhone needs the reversed iOS client ID
 * (`com.googleusercontent.apps.<id>`) registered as a URL scheme, and that is only known to whoever owns the Google project.
 * Set GOOGLE_IOS_URL_SCHEME when building for iOS (an EAS environment variable); without it the plugin stays as it was, which is what Android builds use.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  return withMainActivity(
    {
      ...(config as ExpoConfig),
      plugins: (config.plugins ?? []).map((plugin) => (plugin === GOOGLE_PLUGIN && iosUrlScheme ? [GOOGLE_PLUGIN, { iosUrlScheme }] : plugin)),
    },
    (activity) => ({ ...activity, modResults: { ...activity.modResults, contents: hideFromRecents(activity.modResults.contents) } }),
  );
};
