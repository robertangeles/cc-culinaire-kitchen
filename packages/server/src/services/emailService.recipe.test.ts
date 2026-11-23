import { describe, it, expect, vi, beforeEach } from "vitest";

const send = vi.fn().mockResolvedValue({ error: null });
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));

process.env.RESEND_API_KEY = "re_test";
const { sendRecipeEmail } = await import("./emailService.js");

const ATTACK = `<img src=x onerror="alert(1)">`;

const recipe = (over: Record<string, unknown> = {}) => ({
  name: ATTACK,
  description: ATTACK,
  hookLine: ATTACK,
  yield: "4",
  prepTime: "10 min",
  cookTime: "20 min",
  difficulty: "easy",
  allergenNote: ATTACK,
  ingredients: [{ amount: "1", unit: "cup", name: ATTACK, note: ATTACK }],
  steps: [{ step: 1, instruction: ATTACK }],
  proTips: [ATTACK],
  winePairing: { primary: { wine: ATTACK, why: ATTACK }, alternatives: [{ wine: ATTACK, why: ATTACK }] },
  flavorBalance: { sweet: { score: 7, description: ATTACK } },
  ...over,
});

describe("sendRecipeEmail", () => {
  beforeEach(() => send.mockClear());

  it("escapes every recipe field it puts in the HTML body", async () => {
    await sendRecipeEmail("cook@example.com", recipe(), null, "a-slug", "id-1");

    const { html } = send.mock.calls[0][0] as { html: string };
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("keeps the subject as plain text, on one line", async () => {
    await sendRecipeEmail("cook@example.com", recipe({ name: "Tom & Jerry\r\nBcc: x@y.z" }), null, "a-slug", "id-1");

    const { subject } = send.mock.calls[0][0] as { subject: string };
    expect(subject).toBe("Tom & Jerry Bcc: x@y.z — CulinAIre Kitchen");
  });
});
