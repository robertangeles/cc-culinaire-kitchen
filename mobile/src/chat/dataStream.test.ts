import { describe, expect, it } from "vitest";
import { readDataStream, type StreamEvent } from "./dataStream";

async function* pieces(...parts: string[]) {
  for (const p of parts) yield p;
}

async function all(parts: string[]): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of readDataStream(pieces(...parts))) out.push(e);
  return out;
}

describe("readDataStream (AI SDK v4 data-stream lines)", () => {
  it("yields text parts as they arrive, one per line", async () => {
    expect(await all(['0:"Sear "\n', '0:"hot."\n'])).toEqual([
      { type: "text", text: "Sear " },
      { type: "text", text: "hot." },
    ]);
  });

  it("joins a line split across network pieces, and several lines in one piece", async () => {
    expect(await all(['f:{"messageId":"m1"}\n0:"Pat', ' it dry"\n0:"!"\ne:{"finishReason":"stop"}\n'])).toEqual([
      { type: "text", text: "Pat it dry" },
      { type: "text", text: "!" },
    ]);
  });

  it("reads the grounded-in-your-Brain annotation with its memory titles", async () => {
    const line = `8:${JSON.stringify([{ type: "brain_grounded", memories: [{ memoryId: "a", title: "Fish supplier", sourceType: "note" }, { memoryId: "b", title: null, sourceType: "chat" }] }])}\n`;
    expect(await all([line, '0:"Hi"\n'])).toEqual([
      { type: "grounded", titles: ["Fish supplier", null] },
      { type: "text", text: "Hi" },
    ]);
  });

  it("yields a stream error part as an error", async () => {
    expect(await all(['0:"Half"\n', '3:"That took too long. Please try again."\n'])).toEqual([
      { type: "text", text: "Half" },
      { type: "error", message: "That took too long. Please try again." },
    ]);
  });

  it("reads a last line that has no newline, and skips lines it cannot read", async () => {
    expect(await all(["garbage\n", '0:{not json\n', "9:[]\n", '0:"end"'])).toEqual([{ type: "text", text: "end" }]);
  });

  it("ignores annotations of other types and a text part that is not a string", async () => {
    expect(await all(['8:[{"type":"other"}]\n', "0:42\n"])).toEqual([]);
  });
});
