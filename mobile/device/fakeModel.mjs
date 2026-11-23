/* global process, setTimeout, TextEncoder, ReadableStream, URL, Response, DOMException -- runs in the API server's Node, not on the phone */
/**
 * A stand-in for the model provider, for device walks and the streaming spike: no paid key, no real model call.
 * Preload it into the API server and every OpenRouter chat call is answered here, slowly, as a real stream:
 *
 *   NODE_OPTIONS="--import $PWD/mobile/device/fakeModel.mjs" OPENROUTER_API_KEY=fake pnpm --filter @culinaire/server exec tsx src/index.ts
 *
 * FAKE_MODEL_DELAY_MS   gap between streamed words (default 250)
 * FAKE_RECIPE_MS        how long a recipe or a refinement takes (default 8000), so the wait can be seen
 * A user message containing "[fake:fail]" gets a provider error (the server turns it into AI_UNAVAILABLE).
 * Recipe generation and refinement (`generateObject`, which asks for a "json" tool call) get a fixed recipe.
 * Any other OpenRouter call (embeddings, images) is refused with 503, which the server already handles.
 */

const realFetch = globalThis.fetch;
const delay = Number(process.env.FAKE_MODEL_DELAY_MS ?? 250);
const recipeDelay = Number(process.env.FAKE_RECIPE_MS ?? 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function lastUserText(body) {
  const user = [...(body.messages ?? [])].reverse().find((m) => m.role === "user");
  if (!user) return "";
  return typeof user.content === "string" ? user.content : user.content.map((p) => p.text ?? "").join(" ");
}

function answerFor(question) {
  return [
    `**Fake kitchen answer** to: ${question.slice(0, 80)}\n\n`,
    "Sear the fish skin side down in a hot pan, ",
    "press it flat for the first ten seconds, ",
    "then leave it alone until the skin releases.\n\n",
    "- Pat the skin dry\n",
    "- Salt just before cooking\n",
    "- Rest for one minute\n\n",
    "This text came from the fake model, one piece at a time.",
  ].flatMap((line) => line.split(/(?<= )/));
}

const RECIPE = {
  name: "Cider-braised chicken thighs",
  description: "Crisp-skinned thighs braised in dry cider with soft shallots. Made by the fake model.",
  yield: "4 plates",
  prepTime: "15 min",
  cookTime: "1 h",
  difficulty: "intermediate",
  ingredients: [
    { amount: "8", unit: "", name: "chicken thighs", note: "skin on, bone in" },
    { amount: "300", unit: "ml", name: "dry cider" },
    { amount: "6", unit: "", name: "shallots", note: "halved" },
    { amount: "20", unit: "g", name: "butter" },
  ],
  steps: [
    { step: 1, instruction: "Season the thighs and brown them skin side down until deep gold." },
    { step: 2, instruction: "Soften the shallots in the fat, then pour in the cider and scrape the pan." },
    { step: 3, instruction: "Return the thighs skin side up and braise uncovered for 45 minutes." },
  ],
  proTips: ["Keep the skin above the liquid so it stays crisp."],
  allergenNote: "Contains dairy (butter) and sulphites (cider).",
  imagePrompt: "One plated braised chicken thigh",
  confidenceNote: "A classic method; timings are for bone-in thighs.",
  whyThisWorks: "Cider's acidity balances the rich thigh meat.",
};

/** The `generateObject` reply in tool mode: one call of the "json" tool with the object as its arguments. */
function objectReply(body) {
  const tool = body.tools?.[0]?.function;
  const refine = Boolean(tool?.parameters?.properties?.refinedData);
  const object = refine
    ? { refinedData: { ...RECIPE, name: "Cider-braised chicken thighs, dairy-free", ingredients: RECIPE.ingredients.map((i) => (i.name === "butter" ? { amount: "2", unit: "tbsp", name: "olive oil" } : i)) }, changeSummary: "Swapped the butter for olive oil." }
    : RECIPE;
  return JSON.stringify({
    id: "fake",
    object: "chat.completion",
    created: 0,
    model: "fake/model",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: tool?.name ?? "json", arguments: JSON.stringify(object) } }] } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function sse(words) {
  const enc = new TextEncoder();
  const chunk = (delta, finish = null) =>
    enc.encode(`data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 0, model: "fake/model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(chunk({ role: "assistant", content: "" }));
      for (const w of words) {
        await sleep(delay);
        controller.enqueue(chunk({ content: w }));
      }
      controller.enqueue(chunk({}, "stop"));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://openrouter.ai/")) return realFetch(input, init);
  if (!url.endsWith("/chat/completions")) return new Response(JSON.stringify({ error: { message: "fake model: not served" } }), { status: 503 });

  const body = JSON.parse(init?.body ?? "{}");
  const question = lastUserText(body);
  if (question.includes("[fake:fail]")) return new Response(JSON.stringify({ error: { message: "fake provider failure" } }), { status: 500 });
  if (!body.stream && body.tools?.length) {
    await sleep(recipeDelay);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return new Response(objectReply(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (!body.stream) return new Response(JSON.stringify({ error: { message: "fake model: not served" } }), { status: 503 });
  return new Response(sse(answerFor(question)), { status: 200, headers: { "Content-Type": "text/event-stream" } });
};
