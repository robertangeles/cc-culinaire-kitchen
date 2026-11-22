/**
 * A version 4 uuid, made on the phone before anything is sent: it is the row id the server stores (`wasteLogId`, ...),
 * so a resend after a lost reply finds the same row instead of making a second one.
 * shortcut: the last resort is Math.random, fine for "no other row holds it" (the server also checks the owner), not for secrets.
 */
export function newUuid(): string {
  const c = globalThis.crypto as Partial<Crypto> | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
