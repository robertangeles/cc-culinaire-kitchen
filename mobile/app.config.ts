import type { ConfigContext, ExpoConfig } from "expo/config";

const GOOGLE_PLUGIN = "@react-native-google-signin/google-signin";

/**
 * app.json plus the one value that differs per build: Google sign-in on iPhone needs the reversed iOS client ID
 * (`com.googleusercontent.apps.<id>`) registered as a URL scheme, and that is only known to whoever owns the Google project.
 * Set GOOGLE_IOS_URL_SCHEME when building for iOS (an EAS environment variable); without it the plugin stays as it was, which is what Android builds use.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const iosUrlScheme = process.env.GOOGLE_IOS_URL_SCHEME;
  return {
    ...(config as ExpoConfig),
    plugins: (config.plugins ?? []).map((plugin) => (plugin === GOOGLE_PLUGIN && iosUrlScheme ? [GOOGLE_PLUGIN, { iosUrlScheme }] : plugin)),
  };
};
