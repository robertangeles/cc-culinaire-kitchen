import { useSyncExternalStore } from "react";
import { createApiClient } from "../api/client";
import { createAuthApi } from "../api/auth";
import { createSession, type Session } from "../auth/session";
import { createSecureTokenStore } from "../auth/secureTokenStore";
import { apiBaseUrl, appVersion } from "../config";

// One of each for the whole app. The client's "session ended" callback reaches the session through this binding.
const tokenStore = createSecureTokenStore();
// eslint-disable-next-line prefer-const -- assigned after the client that calls into it
let session: Session;
export const client = createApiClient({ baseUrl: apiBaseUrl, tokenStore, appVersion, onSessionExpired: () => session.sessionExpired() });
session = createSession({ api: createAuthApi(client, tokenStore), hasTokens: async () => (await tokenStore.load()) !== null });

export { session };

/** The current screen state and busy flag, re-rendering when either changes. */
export function useSession() {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
