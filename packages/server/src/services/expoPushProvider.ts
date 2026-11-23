/**
 * @module services/expoPushProvider
 *
 * Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/): one HTTPS call takes up to 100
 * messages and answers with one ticket each; the delivery receipt for a ticket is asked for separately a while later.
 * Expo holds the APNs and FCM credentials (uploaded with EAS), so the only setting this server needs is an optional
 * access token for accounts that turned on enhanced push security.
 *
 * `PushProvider` is the seam the dispatcher depends on; tests give it a fake and never call Expo.
 */

const EXPO_BASE_URL = "https://exp.host/--/api/v2/push";
const CALL_TIMEOUT_MS = 15_000;
const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;

export interface PushMessage {
  /** An `ExponentPushToken[...]`. */
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushTicket = { status: "ok"; id: string } | { status: "error"; error?: string; message?: string };
export type PushReceipt = { status: "ok" } | { status: "error"; error?: string; message?: string };

export interface PushProvider {
  /** One ticket per message, in order. Throws when the provider cannot be reached or refuses the call: nothing is known about any message then. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
  /** A receipt for each ticket the provider already has one for; a missing key means "not ready yet". */
  receipts(ticketIds: string[]): Promise<Map<string, PushReceipt>>;
}

interface ExpoResult {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
}

const toResult = (r: ExpoResult) =>
  r.status === "ok" ? { status: "ok" as const, id: r.id ?? "" } : { status: "error" as const, error: r.details?.error, message: r.message };

export function createExpoPushProvider(opts: { baseUrl?: string; accessToken?: string } = {}): PushProvider {
  const baseUrl = opts.baseUrl ?? EXPO_BASE_URL;

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Expo push service answered HTTP ${res.status}`);
    return res.json();
  }

  return {
    async send(messages) {
      const tickets: PushTicket[] = [];
      for (let i = 0; i < messages.length; i += SEND_CHUNK) {
        const chunk = messages.slice(i, i + SEND_CHUNK);
        const { data } = (await post("/send", chunk)) as { data?: ExpoResult[] };
        if (!Array.isArray(data) || data.length !== chunk.length) throw new Error("Expo push service did not return one ticket per message");
        tickets.push(...data.map(toResult));
      }
      return tickets;
    },

    async receipts(ticketIds) {
      const out = new Map<string, PushReceipt>();
      for (let i = 0; i < ticketIds.length; i += RECEIPT_CHUNK) {
        const { data } = (await post("/getReceipts", { ids: ticketIds.slice(i, i + RECEIPT_CHUNK) })) as { data?: Record<string, ExpoResult> };
        for (const [id, r] of Object.entries(data ?? {})) {
          out.set(id, r.status === "ok" ? { status: "ok" } : { status: "error", error: r.details?.error, message: r.message });
        }
      }
      return out;
    },
  };
}
