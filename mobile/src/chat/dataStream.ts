/**
 * Reads the chat answer as `POST /api/chat` streams it: the Vercel AI SDK v4 data-stream format, one `<code>:<json>` line
 * per part (`0` text, `3` error, `8` annotations). It is not SSE. Network pieces can end mid-line, so lines are joined
 * here. Every other part (message ids, tool calls, the finish line) is skipped, and so is a line that cannot be read.
 */

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  /** The answer drew on the kitchen's own notes (the web's "Grounded in your Brain" chip); a title can be null. */
  | { type: "grounded"; titles: (string | null)[] };

function parseLine(line: string): StreamEvent | null {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(colon + 1));
  } catch {
    return null;
  }
  const code = line.slice(0, colon);
  if (code === "0") return typeof value === "string" ? { type: "text", text: value } : null;
  if (code === "3") return { type: "error", message: typeof value === "string" ? value : "" };
  if (code === "8" && Array.isArray(value)) {
    const grounded = value.find((a) => a?.type === "brain_grounded");
    if (!grounded) return null;
    const memories: unknown[] = Array.isArray(grounded.memories) ? grounded.memories : [];
    return { type: "grounded", titles: memories.map((m) => (typeof (m as { title?: unknown })?.title === "string" ? (m as { title: string }).title : null)) };
  }
  return null;
}

export async function* readDataStream(pieces: AsyncIterable<string>): AsyncGenerator<StreamEvent> {
  let buffer = "";
  for await (const piece of pieces) {
    buffer += piece;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const event = parseLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event) yield event;
    }
  }
  const last = buffer.trim() ? parseLine(buffer) : null;
  if (last) yield last;
}
