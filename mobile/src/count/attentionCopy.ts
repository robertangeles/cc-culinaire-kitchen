import type { Answer } from "./countFlow";
import type { AttentionReason } from "../outbox/outbox";

export type AttentionAction = "enter_again" | "discard" | "sign_in";

/** One plain sentence per reason, and only the actions that can work for it. The typed number and time are always kept. */
export function attentionCopy(reason: AttentionReason, serverMessage: string): { sentence: string; actions: AttentionAction[] } {
  switch (reason) {
    case "area_closed":
      return { sentence: "This area was already sent for review, so this count wasn't added.", actions: ["discard"] };
    case "not_yours":
      return { sentence: "Someone else is counting this area, so this count wasn't added.", actions: ["discard"] };
    case "claim_changed":
      return { sentence: "This area was started again after you counted it. Enter the count again if it is still right.", actions: ["enter_again", "discard"] };
    case "signed_out":
      return { sentence: "You were signed out. Sign in again and this count will be sent.", actions: ["sign_in", "discard"] };
    case "no_access":
      return { sentence: "Your account can't add counts here any more. Ask your manager.", actions: ["discard"] };
    case "rejected":
      return { sentence: serverMessage || "The server didn't accept this count.", actions: ["enter_again", "discard"] };
    case "server_error":
      return { sentence: "The server couldn't save this count after several tries. Try again later.", actions: ["enter_again", "discard"] };
    case "unsupported":
      return { sentence: "This count was saved by a newer version of the app. Update the app and it will be sent.", actions: ["discard"] };
  }
}

/** "6 kg of Shiraz", named in the discard confirmation so the chef knows exactly what is being thrown away. */
export function describeCount(name: string, answer: Pick<Answer, "rawQty" | "countedUnit">): string {
  return `${answer.rawQty} ${answer.countedUnit} of ${name}`;
}
