import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Billing is deferred and paid plans are sold on the web (owner decision), so nothing in the app may offer to buy, price or upgrade.
// Store rule 3.1.3(b) is the reason: an app that links to web purchases must also sell them in the app.
const forbidden = /\b(pricing|price list|purchase|checkout|stripe|paywall|billing|subscribe|subscription|upgrade your|upgrade to|go premium|free trial)\b/i;

describe("no purchase, pricing or upgrade wording anywhere in the app", () => {
  it.each([...sourceFiles(join(root, "app")), ...sourceFiles(join(root, "src", "ui"))])("%s", (file) => {
    const lines = readFileSync(file, "utf8").split("\n");
    const hits = lines.map((text, i) => ({ text, n: i + 1 })).filter(({ text }) => forbidden.test(text) && !text.trim().startsWith("//") && !text.trim().startsWith("*") && !text.trim().startsWith("/*"));
    expect(hits).toEqual([]);
  });
});
