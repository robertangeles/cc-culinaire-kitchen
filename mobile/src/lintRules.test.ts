import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const eslint = new ESLint({ cwd: root });

async function messages(code: string, file: string) {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, file) });
  return result.messages.map((m) => `${m.ruleId}: ${m.message}`);
}

describe("phone lint rule: only the API client may call the network", () => {
  it("rejects fetch in a screen", async () => {
    expect(await messages('export const x = () => fetch("/api");', "mobile/src/screens/Count.ts")).toEqual([
      expect.stringMatching(/^no-restricted-globals: .*Call the API client in mobile\/src\/api, not fetch\./),
    ]);
  });

  it("rejects XMLHttpRequest in a screen", async () => {
    expect(await messages("export const x = new XMLHttpRequest();", "mobile/src/screens/Count.ts")).toEqual([
      expect.stringMatching(/^no-restricted-globals: .*Call the API client in mobile\/src\/api, not XMLHttpRequest\./),
    ]);
  });

  it("allows fetch in the API client", async () => {
    expect(await messages('export const x = () => fetch("/api");', "mobile/src/api/client.ts")).toEqual([]);
  });
});
