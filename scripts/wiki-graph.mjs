#!/usr/bin/env node
// Level 4 — graph relationships across the wiki.
//
// Walks wiki/**/*.md, parses minimal frontmatter (title, category, created,
// updated) and extracts every `[[slug]]` reference (frontmatter `related:`
// list AND inline body backlinks). Persists the graph as JSON at
// wiki/.graph.json so Claude can answer relational queries without reading
// every page.
//
// Usage:
//   node scripts/wiki-graph.mjs build              rebuild wiki/.graph.json
//   node scripts/wiki-graph.mjs neighbors <slug>   show in/out edges
//   node scripts/wiki-graph.mjs orphans            pages with no edges
//   node scripts/wiki-graph.mjs category <name>    pages in a category
//   node scripts/wiki-graph.mjs broken             [[slug]] refs to missing pages
//   node scripts/wiki-graph.mjs stats              counts per category + edge count
//   node scripts/wiki-graph.mjs auto               stdin-gated rebuild (PostToolUse hook)
//
// JSON shape: { nodes: [{slug, title, category, path, created, updated}],
//               edges: [{from, to}] }
//
// Upgrade path: when the graph crosses ~1000 nodes or you want SQL-style
// joins, swap the JSON store for SQLite via Node 24's built-in `node:sqlite`
// (no new deps). Same nodes/edges schema maps cleanly to two tables.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, basename, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIKI = join(ROOT, "wiki");
const GRAPH = join(WIKI, ".graph.json");

const SKIP_SLUGS = new Set(["index", "log", ".graph"]);

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!km) continue;
    fm[km[1]] = km[2].trim();
  }
  return fm;
}

function extractRefs(src) {
  return [...src.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((m) => m[1].trim());
}

async function build() {
  const files = await walk(WIKI);
  const nodes = [];
  const edges = [];
  for (const file of files) {
    const slug = basename(file, ".md");
    if (SKIP_SLUGS.has(slug)) continue;
    const src = await readFile(file, "utf-8");
    const fm = parseFrontmatter(src);
    nodes.push({
      slug,
      title: fm.title ?? slug,
      category: fm.category ?? "unknown",
      path: relative(ROOT, file).replaceAll("\\", "/"),
      created: fm.created ?? null,
      updated: fm.updated ?? null,
    });
    const seen = new Set();
    for (const ref of extractRefs(src)) {
      if (ref === slug || seen.has(ref)) continue;
      seen.add(ref);
      edges.push({ from: slug, to: ref });
    }
  }
  const graph = { nodes, edges, builtAt: new Date().toISOString() };
  await writeFile(GRAPH, JSON.stringify(graph, null, 2) + "\n");
  console.log(
    `Built graph: ${nodes.length} nodes, ${edges.length} edges → ${relative(ROOT, GRAPH).replaceAll("\\", "/")}`,
  );
}

async function loadGraph() {
  try {
    return JSON.parse(await readFile(GRAPH, "utf-8"));
  } catch {
    console.error(`Graph not built yet. Run: node scripts/wiki-graph.mjs build`);
    process.exit(1);
  }
}

async function neighbors(slug) {
  if (!slug) return usage();
  const { nodes, edges } = await loadGraph();
  const node = nodes.find((n) => n.slug === slug);
  if (!node) {
    console.error(`No such page: ${slug}`);
    process.exit(1);
  }
  const out = edges.filter((e) => e.from === slug).map((e) => e.to);
  const inc = edges.filter((e) => e.to === slug).map((e) => e.from);
  console.log(`# ${node.title}  (${node.category})`);
  console.log(`  path:     ${node.path}`);
  console.log(`  outgoing: [${out.join(", ") || "—"}]`);
  console.log(`  incoming: [${inc.join(", ") || "—"}]`);
}

async function orphans() {
  const { nodes, edges } = await loadGraph();
  const referenced = new Set(edges.flatMap((e) => [e.from, e.to]));
  const result = nodes
    .filter((n) => !referenced.has(n.slug))
    .map((n) => `${n.slug}\t${n.path}`);
  console.log(result.length ? result.join("\n") : "(no orphans)");
}

async function category(name) {
  if (!name) return usage();
  const { nodes } = await loadGraph();
  const matches = nodes.filter((n) => n.category === name);
  if (!matches.length) {
    console.log(`(no pages in category: ${name})`);
    return;
  }
  for (const n of matches) console.log(`${n.slug}\t${n.title}`);
}

async function broken() {
  const { nodes, edges } = await loadGraph();
  const slugs = new Set(nodes.map((n) => n.slug));
  const missing = edges
    .filter((e) => !slugs.has(e.to))
    .map((e) => `${e.from} → ${e.to}`);
  console.log(missing.length ? missing.join("\n") : "(no broken refs)");
}

async function stats() {
  const { nodes, edges, builtAt } = await loadGraph();
  const byCat = nodes.reduce((acc, n) => {
    acc[n.category] = (acc[n.category] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`built:    ${builtAt}`);
  console.log(`nodes:    ${nodes.length}`);
  console.log(`edges:    ${edges.length}`);
  console.log(`by category:`);
  for (const [c, n] of Object.entries(byCat).sort()) {
    console.log(`  ${c.padEnd(12)} ${n}`);
  }
}

async function auto() {
  // PostToolUse hook entrypoint. Reads the hook-input JSON from stdin,
  // checks whether the touched file is a wiki .md page, and if so rebuilds
  // the graph silently. Always exits 0 so a hook failure never blocks tools.
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  let file = "";
  try {
    file = JSON.parse(payload)?.tool_input?.file_path ?? "";
  } catch {
    return;
  }
  const norm = file.replaceAll("\\", "/");
  if (!/\/wiki\/.*\.md$/i.test(norm)) return;
  if (/\/wiki\/\.graph\.json$/i.test(norm)) return;
  try {
    await build();
  } catch {
    // Swallow — never block tool flow.
  }
}

function usage() {
  console.log(
    `Usage:
  node scripts/wiki-graph.mjs build              rebuild wiki/.graph.json
  node scripts/wiki-graph.mjs neighbors <slug>   show in/out edges
  node scripts/wiki-graph.mjs orphans            pages with no edges
  node scripts/wiki-graph.mjs category <name>    pages in a category
  node scripts/wiki-graph.mjs broken             [[slug]] refs to missing pages
  node scripts/wiki-graph.mjs stats              counts per category + edge count
  node scripts/wiki-graph.mjs auto               stdin-gated rebuild (PostToolUse hook)`,
  );
}

const [, , cmd, arg] = process.argv;
switch (cmd) {
  case "build":
    await build();
    break;
  case "neighbors":
    await neighbors(arg);
    break;
  case "orphans":
    await orphans();
    break;
  case "category":
    await category(arg);
    break;
  case "broken":
    await broken();
    break;
  case "stats":
    await stats();
    break;
  case "auto":
    await auto();
    break;
  default:
    usage();
}
