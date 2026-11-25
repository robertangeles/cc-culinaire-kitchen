import { useSyncExternalStore } from "react";
import { fetch as streamingFetch } from "expo/fetch";
import { createApiClient } from "../api/client";
import { createAuthApi } from "../api/auth";
import { createAccountApi, type AppleProof } from "../api/account";
import { createLegalApi } from "../legal/legalApi";
import { createNotificationsApi } from "../notifications/notificationsApi";
import { createPush } from "../notifications/push";
import { nativePush } from "../notifications/nativePush";
import { createSession, type Session } from "../auth/session";
import { createSecureTokenStore } from "../auth/secureTokenStore";
import { createSnapshotStore } from "../auth/snapshotStore";
import { sqliteKv } from "../storage/kv";
import { wipeLocalData } from "../storage/wipe";
import { googleIdToken } from "../auth/googleSignIn";
import { appleCredential, appleEnabled } from "../auth/appleSignIn";
import { apiBaseUrl, appVersion, googleEnabled } from "../config";

// One of each for the whole app. The client's "session ended" callback reaches the session through this binding.
export const tokenStore = createSecureTokenStore();
// eslint-disable-next-line prefer-const -- assigned after the client that calls into it
let session: Session;
// The built-in fetch buffers a whole response; `expo/fetch` hands the body over as it arrives (chat answers stream).
export const client = createApiClient({ baseUrl: apiBaseUrl, tokenStore, appVersion, streamFetchFn: streamingFetch as unknown as typeof fetch, onSessionExpired: () => session.sessionExpired(), onUpgradeRequired: (body) => session.updateRequired(body) });
export const authApi = createAuthApi(client, tokenStore);
export const accountApi = createAccountApi(client, tokenStore);
export const legalApi = createLegalApi(client);
export const notificationsApi = createNotificationsApi(client, tokenStore);
const signedInUserId = () => {
  const s = session.getSnapshot().state;
  return s.phase === "ready" ? s.user.userId : null;
};
/** Push on this phone: off until the person turns it on (the inbox or Notification settings); see `src/notifications/push.ts`. */
export const push = createPush({ native: nativePush, api: notificationsApi, kv: sqliteKv, getUserId: signedInUserId });
/** Opens Apple's sign-in sheet for a fresh credential, to confirm deleting an Apple-linked account (null when the sheet is closed). */
export const appleProof: (() => Promise<AppleProof | null>) | undefined = appleEnabled
  ? async () => {
      const credential = await appleCredential();
      return credential && { identityToken: credential.identityToken, nonce: credential.nonce };
    }
  : undefined;
session = createSession({
  api: authApi,
  hasTokens: async () => (await tokenStore.load()) !== null,
  snapshots: createSnapshotStore(sqliteKv),
  googleIdToken: googleEnabled ? googleIdToken : undefined,
  wipeLocalData,
  appleCredential: appleEnabled ? appleCredential : undefined,
  beforeSignOut: () => push.beforeSignOut(),
});

export { session, googleEnabled, appleEnabled, appleCredential };

/** The current screen state and busy flag, re-rendering when either changes. */
export function useSession() {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}

/** Push on this phone: off, on, blocked or unavailable. */
export function usePushStatus() {
  return useSyncExternalStore(push.subscribe, push.getStatus);
}
