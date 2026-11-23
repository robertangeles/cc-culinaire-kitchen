import { useSyncExternalStore } from "react";
import { fetch as streamingFetch } from "expo/fetch";
import { createApiClient } from "../api/client";
import { createAuthApi } from "../api/auth";
import { createAccountApi, type AppleProof } from "../api/account";
import { createLegalApi } from "../legal/legalApi";
import { createSession, type Session } from "../auth/session";
import { createSecureTokenStore } from "../auth/secureTokenStore";
import { createSnapshotStore } from "../auth/snapshotStore";
import { sqliteKv } from "../storage/kv";
import { wipeLocalData } from "../storage/wipe";
import { googleIdToken } from "../auth/googleSignIn";
import { appleCredential, appleEnabled } from "../auth/appleSignIn";
import { apiBaseUrl, appVersion, googleEnabled } from "../config";

// One of each for the whole app. The client's "session ended" callback reaches the session through this binding.
const tokenStore = createSecureTokenStore();
// eslint-disable-next-line prefer-const -- assigned after the client that calls into it
let session: Session;
// The built-in fetch buffers a whole response; `expo/fetch` hands the body over as it arrives (chat answers stream).
export const client = createApiClient({ baseUrl: apiBaseUrl, tokenStore, appVersion, streamFetchFn: streamingFetch as unknown as typeof fetch, onSessionExpired: () => session.sessionExpired(), onUpgradeRequired: (body) => session.updateRequired(body) });
export const authApi = createAuthApi(client, tokenStore);
export const accountApi = createAccountApi(client, tokenStore);
export const legalApi = createLegalApi(client);
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
});

export { session, googleEnabled, appleEnabled };

/** The current screen state and busy flag, re-rendering when either changes. */
export function useSession() {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
