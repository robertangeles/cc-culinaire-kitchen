/**
 * Test support for the push suites: a fake push provider that records what it is asked to send and answers from a script.
 * Never imported by production code.
 */
import type { PushMessage, PushProvider, PushReceipt, PushTicket } from "./expoPushProvider.js";

export class FakePushProvider implements PushProvider {
  sent: PushMessage[] = [];
  receiptRequests: string[][] = [];
  /** Throw from `send`, as when the provider is unreachable. */
  failSend = false;
  /** Tokens (the `to` of a message) the provider answers "DeviceNotRegistered" for at once. */
  deadTokens = new Set<string>();
  /** The receipts the provider has, by ticket id; a ticket not here is "not ready yet". */
  receiptScript = new Map<string, PushReceipt>();
  /** The ticket id each token was last given, so a test can script that token's receipt. */
  ticketByToken = new Map<string, string>();
  private n = 0;

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (this.failSend) throw new Error("fake push provider is down");
    this.sent.push(...messages);
    return messages.map((m) => {
      if (this.deadTokens.has(m.to)) return { status: "error", error: "DeviceNotRegistered", message: "not registered" };
      const id = `fake-ticket-${++this.n}`;
      this.ticketByToken.set(m.to, id);
      return { status: "ok", id };
    });
  }

  async receipts(ticketIds: string[]): Promise<Map<string, PushReceipt>> {
    this.receiptRequests.push(ticketIds);
    return new Map(ticketIds.flatMap((id) => (this.receiptScript.has(id) ? [[id, this.receiptScript.get(id)!] as const] : [])));
  }
}
