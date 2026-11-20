import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { googleWebClientId } from "../config";

let configured = false;

/**
 * Opens the Google account picker and returns the ID token the server verifies, or null when the person closes the picker.
 * `webClientId` is the Web application client (the token's audience), not the Android one, which Google Play Services
 * matches by package name and signing-key fingerprint.
 */
export async function googleIdToken(): Promise<string | null> {
  if (!configured) {
    GoogleSignin.configure({ webClientId: googleWebClientId, offlineAccess: false });
    configured = true;
  }
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type === "cancelled") return null;
  return response.data.idToken;
}
