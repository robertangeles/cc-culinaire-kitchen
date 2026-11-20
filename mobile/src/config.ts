import Constants from "expo-constants";

const url = process.env.EXPO_PUBLIC_API_URL;
if (!url) {
  throw new Error("EXPO_PUBLIC_API_URL is not set. Copy mobile/.env.example to mobile/.env and set it.");
}

/** The server the app talks to. Set per build (dev points at a local or dev server, never silently at production). */
export const apiBaseUrl = url.replace(/\/+$/, "");

/** Sent on every call as X-Mobile-App-Version so the server can ask an old build to update. */
export const appVersion = Constants.expoConfig?.version ?? "0.0.0";
