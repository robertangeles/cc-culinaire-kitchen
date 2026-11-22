/**
 * @module middleware/socketAuth
 *
 * Where a Socket.io handshake carries the access token: the `auth.token` payload (what a
 * native client sets), an `Authorization: Bearer` header, or the web client's `access_token` cookie.
 */

/** Parse cookie header string into key-value pairs */
export function parseCookie(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key.trim()] = rest.join("=").trim();
  }
  return cookies;
}

export function extractHandshakeToken(handshake: {
  auth?: Record<string, unknown>;
  headers: { authorization?: string; cookie?: string };
}): string | null {
  const authToken = handshake.auth?.token;
  if (typeof authToken === "string" && authToken) return authToken;

  const header = handshake.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const bearer = header.slice(7).trim();
    if (bearer) return bearer;
  }

  const cookie = handshake.headers.cookie;
  return (cookie && parseCookie(cookie)["access_token"]) || null;
}
