#!/usr/bin/env node
// Level 2 — fast local search across the wiki.
//
// Usage:
//   node scripts/wiki-search.mjs <query>            list matching wiki page paths
//   node scripts/wiki-search.mjs -c <query>         show 2 lines of context per match
//
// Use this BEFORE Reading full wiki pages so Claude can pick the right ones
// without scanning every file. Searches wiki/ recursively, .md files only.
// Pure Node implementation — no ripgrep dependency. Fast enough for hundreds
// of pages; if the wiki crosses ~5000 pages, swap in real ripgrep.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = join(ROOT, "wiki");

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function search({ query, withContext }) {
  const re = new RegExp(escapeRegex(query), "i");
  const files = await walk(WIKI);
  let hits = 0;
  for (const file of files) {
    const src = await readFile(file, "utf-8");
    const lines = src.split(/\r?\n/);
    const matchedLines = [];
    lines.forEach((line, i) => {
      if (re.test(line)) matchedLines.push(i);
    });
    if (!matchedLines.length) continue;
    hits++;
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (!withContext) {
      console.log(rel);
      continue;
    }
    console.log(`\n${rel}`);
    const printed = new Set();
    for (const i of matchedLines) {
      for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
        if (printed.has(j)) continue;
        printed.add(j);
        const marker = j === i ? ">" : " ";
        console.log(`  ${marker} ${j + 1}: ${lines[j]}`);
      }
    }
  }
  if (!hits) console.error(`No matches for: ${query}`);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`Usage:
  node scripts/wiki-search.mjs <query>            list matching wiki page paths
  node scripts/wiki-search.mjs -c <query>         show 2 lines of context per match`);
  process.exit(args.length === 0 ? 1 : 0);
}

const withContext = args[0] === "-c";
const query = (withContext ? args.slice(1) : args).join(" ");
if (!query) {
  console.error("Missing query.");
  process.exit(1);
}
await search({ query, withContext });
