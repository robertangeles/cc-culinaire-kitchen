import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

const defaults: Record<string, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
};

type Provider = "anthropic" | "openai";

export interface ModelOptions {
  /** When true and using Anthropic, inject the web_search_20250305 tool. */
  webSearch?: boolean;
}

/**
 * Return the current AI provider name (e.g. "anthropic" or "openai").
 */
export function getProviderName(): Provider {
  return (process.env.AI_PROVIDER ?? "anthropic") as Provider;
}

/**
 * Format web_search_tool_result content blocks into readable markdown text.
 * Called when the response stream contains search results that need to be
 * converted to text blocks the SDK can handle.
 */
function formatSearchResults(block: Record<string, unknown>): string {
  const content = block.content;
  if (!content || !Array.isArray(content)) {
    return "\n[Web search completed]\n";
  }
  const results = content
    .filter((item: Record<string, unknown>) => item.type === "web_search_result")
    .map(
      (item: Record<string, unknown>) =>
        `- [${item.title}](${item.url})${item.snippet ? `: ${item.snippet}` : ""}`,
    )
    .join("\n");
  return results ? `\n**Sources:**\n${results}\n` : "\n[Web search completed]\n";
}

/**
 * Build and return the configured LLM model instance.
 *
 * When `options.webSearch` is true and the provider is Anthropic, the
 * model is configured with a custom `fetch` wrapper that:
 * 1. Injects the `web_search_20250305` server tool into the request body
 * 2. Transforms the response stream to filter out `server_tool_use` events
 *    and convert `web_search_tool_result` blocks to text — because the
 *    @ai-sdk/anthropic SDK doesn't handle server tool content block types
 */
export function getModel(options: ModelOptions = {}) {
  const provider = getProviderName();
  const model = process.env.AI_MODEL ?? defaults[provider];

  if (provider !== "anthropic" && provider !== "openai") {
    throw new Error(`Unknown AI provider: ${provider}. Use "anthropic" or "openai".`);
  }

  if (provider === "anthropic" && options.webSearch) {
    const webSearchProvider = createAnthropic({
      fetch: async (url, init) => {
        // Inject web_search tool into request body
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body);
            body.tools = body.tools || [];
            body.tools.push({
              type: "web_search_20250305",
              name: "web_search",
            });
            init = { ...init, body: JSON.stringify(body) };
          } catch {
            // If body parsing fails, proceed without modification.
          }
        }

        const response = await globalThis.fetch(url, init);

        // Only transform streaming SSE responses
        if (
          !response.body ||
          !response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          return response;
        }

        // Transform the SSE stream: filter out server_tool_use events and
        // convert web_search_tool_result blocks to text blocks.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        // Indices of blocks to fully suppress (server_tool_use — skip start, delta, stop)
        const serverToolIndices = new Set<number>();
        // Indices of converted blocks (web_search_tool_result → text — skip deltas only)
        const convertedIndices = new Set<number>();
        // Maps original block index → remapped index (closing gaps from removed blocks)
        const indexMap = new Map<number, number>();
        let nextMappedIndex = 0;
        // Tracks whether the previous line was an `event:` line that should be skipped
        let pendingEventLine: string | null = null;
        // Buffer for incomplete data: lines split across chunks
        let pendingDataLine = "";

        const transformedStream = new ReadableStream({
          async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
              if (pendingDataLine) {
                controller.enqueue(encoder.encode(pendingDataLine));
              }
              controller.close();
              return;
            }

            const raw = decoder.decode(value, { stream: true });
            // Prepend any buffered partial line from previous chunk
            const text = pendingDataLine + raw;
            pendingDataLine = "";
            const lines = text.split("\n");
            // If text doesn't end with \n, the last element is incomplete
            if (!text.endsWith("\n") && lines.length > 0) {
              pendingDataLine = lines.pop()!;
            }
            const outputLines: string[] = [];

            for (const line of lines) {
              // SSE format: `event: <type>\ndata: <json>\n\n`
              // Buffer `event:` lines — only emit them if their paired `data:` line is kept
              if (line.startsWith("event: ")) {
                // Flush any previous pending event line that had no data pair
                if (pendingEventLine !== null) {
                  outputLines.push(pendingEventLine);
                }
                pendingEventLine = line;
                continue;
              }

              if (!line.startsWith("data: ")) {
                // Blank lines or other non-data lines — flush pending event first
                if (pendingEventLine !== null) {
                  outputLines.push(pendingEventLine);
                  pendingEventLine = null;
                }
                outputLines.push(line);
                continue;
              }

              const jsonStr = line.slice(6).trim();
              if (!jsonStr || jsonStr === "[DONE]") {
                if (pendingEventLine !== null) {
                  outputLines.push(pendingEventLine);
                  pendingEventLine = null;
                }
                outputLines.push(line);
                continue;
              }

              try {
                const event = JSON.parse(jsonStr);

                // Handle content_block_start for server tool types
                if (event.type === "content_block_start") {
                  const block = event.content_block;

                  if (block?.type === "server_tool_use") {
                    // Track and skip entirely — drop both event: and data: lines
                    serverToolIndices.add(event.index);
                    pendingEventLine = null;
                    continue;
                  }
                  if (block?.type === "web_search_tool_result") {
                    // Convert search results to a text block the SDK can render.
                    // Track as converted — skip original deltas but keep stop event.
                    convertedIndices.add(event.index);
                    const mappedIndex = nextMappedIndex++;
                    indexMap.set(event.index, mappedIndex);
                    const searchText = formatSearchResults(block);
                    // Emit content_block_start with empty text (SDK expects this)
                    event.index = mappedIndex;
                    event.content_block = { type: "text", text: "" };
                    if (pendingEventLine !== null) {
                      outputLines.push(pendingEventLine);
                      pendingEventLine = null;
                    }
                    outputLines.push("data: " + JSON.stringify(event));
                    // Blank line to close the SSE event before emitting the delta
                    outputLines.push("");
                    // Emit the search results as a separate SSE text delta event
                    outputLines.push("event: content_block_delta");
                    outputLines.push(
                      "data: " +
                        JSON.stringify({
                          type: "content_block_delta",
                          index: mappedIndex,
                          delta: { type: "text_delta", text: searchText },
                        }),
                    );
                    continue;
                  }

                  // Non-server-tool block — assign a mapped index and
                  // strip `citations` field (SDK doesn't handle it)
                  const mappedIndex = nextMappedIndex++;
                  indexMap.set(event.index, mappedIndex);
                  event.index = mappedIndex;
                  if (block && "citations" in block) {
                    delete block.citations;
                  }
                  if (pendingEventLine !== null) {
                    outputLines.push(pendingEventLine);
                    pendingEventLine = null;
                  }
                  outputLines.push("data: " + JSON.stringify(event));
                  continue;
                }

                // Skip deltas and stops for fully suppressed server tool blocks
                if (
                  (event.type === "content_block_delta" ||
                    event.type === "content_block_stop") &&
                  serverToolIndices.has(event.index)
                ) {
                  pendingEventLine = null;
                  continue;
                }

                // Skip deltas for converted blocks (content already emitted in start)
                // but let stop events pass through (SDK needs matching stop for every start)
                if (
                  event.type === "content_block_delta" &&
                  convertedIndices.has(event.index)
                ) {
                  pendingEventLine = null;
                  continue;
                }

                // Skip citations_delta events — SDK can't handle them
                if (
                  event.type === "content_block_delta" &&
                  event.delta?.type === "citations_delta"
                ) {
                  pendingEventLine = null;
                  continue;
                }

                // Remap indices for delta and stop events
                if (
                  event.type === "content_block_delta" ||
                  event.type === "content_block_stop"
                ) {
                  const mapped = indexMap.get(event.index);
                  if (mapped !== undefined) {
                    event.index = mapped;
                  }
                  if (pendingEventLine !== null) {
                    outputLines.push(pendingEventLine);
                    pendingEventLine = null;
                  }
                  outputLines.push("data: " + JSON.stringify(event));
                  continue;
                }

                // Pass through everything else unchanged
                if (pendingEventLine !== null) {
                  outputLines.push(pendingEventLine);
                  pendingEventLine = null;
                }
                outputLines.push(line);
              } catch {
                // JSON parse failed — pass through (shouldn't happen with
                // trailing-line buffering, but safe fallback)
                if (pendingEventLine !== null) {
                  outputLines.push(pendingEventLine);
                  pendingEventLine = null;
                }
                outputLines.push(line);
              }
            }

            controller.enqueue(encoder.encode(outputLines.join("\n")));
          },
        });

        return new Response(transformedStream, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      },
    });
    return webSearchProvider(model);
  }

  if (provider === "anthropic") {
    return anthropic(model);
  }

  return openai(model);
}
