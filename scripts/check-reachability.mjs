#!/usr/bin/env node
/**
 * Reachability check — can a user actually get to this code?
 *
 * WHY THIS EXISTS. Five defects on the compliance-vault branch had the same
 * shape: code that compiled, type-checked, passed lint, had unit tests, and
 * that no user could reach. Two API routes the client called and nobody had
 * written. Three finished components with zero production imports. An admin
 * screen with no way in. A PDF export wired to nothing.
 *
 * Unit tests are blind to this. They import the component or call the handler
 * directly, which is precisely the thing a real user cannot do. Every one of
 * those five was found by a person opening the running app.
 *
 * Three questions, all answerable from source, all cheap enough for every CI run:
 *
 *   1. Does every client component have a production importer?
 *      A component whose only importer is its own test file is dead.
 *   2. Does every path the client requests exist on the server?
 *      A call to an unregistered path is a 404 the moment a user clicks it.
 *   3. Is every router actually mounted?
 *
 * Plus one ADVISORY report — routes with no client caller — which is real
 * signal but too noisy to gate on. See the note above checkRoutes().
 *
 * Deliberately a string and import scan, not a type-aware AST pass: a failure
 * has to be explainable in one sentence, or people stop reading it.
 *
 * Usage:  node scripts/check-reachability.mjs [--json]
 * Exits non-zero when something is unreachable.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not URL.pathname — this repo lives under a directory with a
// space in its name and pathname hands back the percent-encoded form.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLIENT_SRC = join(ROOT, "packages/client/src");
const SERVER_SRC = join(ROOT, "packages/server/src");

/**
 * Deliberate exceptions. Every entry carries a reason — an allowlist without
 * one becomes the place real bugs go to hide.
 */
const ALLOWED_ORPHANS = {
  routes: [
    { pattern: /^\/api\/mobile\//, reason: "React Native app, separate repo" },
    { pattern: /^\/api\/stripe\/webhook/, reason: "inbound Stripe webhook" },
    { pattern: /^\/api\/health/, reason: "infrastructure health probe" },
    { pattern: /^\/api\/internal\//, reason: "cron/internal caller, not the browser" },
  ],
  components: [
    { pattern: /pages\/LandingPage\.tsx$/, reason: "rendered by the marketing shell, not imported" },
    // KNOWN DEAD CODE, not an exception on merit. 295 lines on main that
    // nothing imports. Listed rather than deleted because it is unrelated to
    // the branch that added this checker — see tasks/todo.md. Delete the file
    // and this entry together.
    { pattern: /components\/inventory\/DeliveryReceiving\.tsx$/, reason: "dead code, pending deletion" },
  ],
  /**
   * Client paths knowingly pointing at nothing. This list should stay empty.
   *
   * The single entry is a LIVE BUG on main, not a design decision: useSales.ts
   * declares `const API = "/api/menu-intelligence"` while index.ts mounts that
   * router at `/api/menu`, so every recipe-based-selling call — record a sale,
   * void a sale, import sales, list consumables — 404s. All seven suffixes
   * match routes the server really defines; only the base is wrong.
   *
   * Allowlisted ONLY so this checker can go into CI without going in red on
   * day one. The fix is one line, and it belongs on its own branch because it
   * has nothing to do with the compliance vault. See tasks/todo.md.
   */
  clientCalls: [
    { pattern: /^\/api\/menu-intelligence\//, reason: "LIVE BUG: base should be /api/menu" },
  ],
};

// ── walking ───────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const isTest = (f) => /\.(test|spec)\.[tj]sx?$/.test(f);
const isSource = (f) => [".ts", ".tsx"].includes(extname(f));

/**
 * Comments come off before any string scanning.
 *
 * Without this, one apostrophe in prose ("don't") pairs with the next quote in
 * the file and every quote after it is off by one. An early version of this
 * script reported 83 live routes as uncalled for exactly that reason, and a
 * checker that cries wolf gets muted.
 */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ── path shapes ───────────────────────────────────────────────────────

/**
 * `:id` on the server and `${id}` on the client both mean "a value goes here",
 * so both become a single `*` segment.
 *
 * `*` rather than an empty string matters: emptying it made
 * `/stock-takes/${id}/previous-lines/${cat}` one segment shorter than the route
 * it calls, and the comparison then rejected a good match on length alone.
 */
const normalise = (p) =>
  p
    .replace(/\$\{[^}]*\}/g, "*")
    .replace(/:[A-Za-z0-9_]+/g, "*")
    // A value glued to literal text, like `org_${id}`, is still one segment.
    .replace(/[^/]*\*[^/]*/g, "*")
    .replace(/\/+$/, "");

/**
 * Same shape segment for segment, `*` matching any single segment.
 *
 * KNOWN BLIND SPOT: matching is method-blind, because the HTTP verb of a
 * `fetch` call cannot be read reliably from source. So a literal segment can be
 * masked by a parameterised sibling — `/documents/upload` matches the route
 * `/documents/:id` and would not be reported missing even if the upload route
 * were deleted. Verified: deleting both new compliance routes flags
 * `/documents/:id/view-url` but not `/documents/upload`.
 *
 * Worth knowing rather than fixing here: the same ambiguity bites Express at
 * runtime, which is why routes/compliance.ts registers collection routes ahead
 * of parameterised ones.
 */
function pathsMatch(a, b) {
  const as = a.split("/");
  const bs = b.split("/");
  if (as.length !== bs.length) return false;
  return as.every((seg, i) => seg === bs[i] || seg === "*" || bs[i] === "*");
}

// ── check 1: components nobody imports ────────────────────────────────

function checkComponents() {
  const production = walk(CLIENT_SRC).filter(isSource).filter((f) => !isTest(f));

  const importedNames = new Map(); // basename -> [importer, ...]
  for (const file of production) {
    for (const m of readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
      if (!m[1].startsWith(".")) continue;
      const name = basename(m[1]).replace(/\.(js|jsx|ts|tsx)$/, "");
      if (!importedNames.has(name)) importedNames.set(name, []);
      importedNames.get(name).push(file);
    }
  }

  const orphans = [];
  for (const file of production) {
    if (/\/(main|App|vite-env)\.tsx?$/.test(file)) continue; // entry points
    if (!/\/(components|pages)\//.test(file)) continue;

    const name = basename(file).replace(/\.(ts|tsx)$/, "");
    const importers = (importedNames.get(name) ?? []).filter((f) => f !== file);
    if (importers.length) continue;

    const rel = relative(ROOT, file);
    if (!ALLOWED_ORPHANS.components.some((a) => a.pattern.test(rel))) orphans.push(rel);
  }
  return orphans.sort();
}

// ── server route inventory ────────────────────────────────────────────

/**
 * Map each mounted router VARIABLE to its prefix.
 *
 * Keyed by variable, not by file, because one file can export two routers
 * mounted at different prefixes — routes/sitePages.ts exports both
 * publicSitePagesRouter (/api/site-pages) and adminSitePagesRouter
 * (/api/admin/site-pages). Keying by filename silently merges them.
 */
function mountPrefixes() {
  const index = readFileSync(join(SERVER_SRC, "index.ts"), "utf8");

  const varToPrefix = new Map();
  for (const m of index.matchAll(/app\.use\(\s*["'](\/[^"']*)["']\s*,\s*(\w+)/g)) {
    varToPrefix.set(m[2], m[1]);
  }

  // Both import styles are in use: `import x from` and `import { x } from`.
  const varToFile = new Map();
  for (const m of index.matchAll(
    /import\s+(?:\{\s*([\w,\s]+?)\s*\}|(\w+))\s+from\s+["']\.\/routes\/([\w.-]+?)(?:\.js)?["']/g,
  )) {
    const names = m[1] ? m[1].split(",").map((n) => n.trim()) : [m[2]];
    for (const n of names) varToFile.set(n, m[3]);
  }
  return { varToPrefix, varToFile };
}

function serverRoutes() {
  const { varToPrefix, varToFile } = mountPrefixes();

  // Files exporting a DEFAULT router write their calls against a local name
  // (usually `router`) that index.ts never sees; resolve those by file.
  const fileDefaultPrefix = new Map();
  for (const [v, prefix] of varToPrefix) {
    const file = varToFile.get(v);
    if (file) fileDefaultPrefix.set(file, prefix);
  }

  const routes = [];

  // Not every route lives in routes/. A few are declared straight on the app
  // in index.ts (the admin database console among them), and missing those
  // makes their perfectly valid callers look like 404s.
  const indexSrc = readFileSync(join(SERVER_SRC, "index.ts"), "utf8");
  for (const m of indexSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*["'](\/api[^"']*)["']/g)) {
    routes.push({ method: m[1].toUpperCase(), path: m[2], file: "index.ts" });
  }

  const routesDir = join(SERVER_SRC, "routes");
  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith(".ts") || isTest(file)) continue;
    const stem = file.replace(/\.ts$/, "");
    const src = readFileSync(join(routesDir, file), "utf8");

    for (const m of src.matchAll(/(\w+)\.(get|post|put|patch|delete)\(\s*["']([^"']*)["']/g)) {
      const [, ident, method, path] = m;
      const prefix = varToPrefix.get(ident) ?? fileDefaultPrefix.get(stem);
      if (!prefix) continue; // not a mounted router, or not a router at all
      const full = (prefix + path).replace(/\/+$/, "") || prefix;
      routes.push({ method: method.toUpperCase(), path: full, file: `routes/${file}` });
    }
  }
  return routes;
}

function unmountedRouters() {
  const { varToPrefix, varToFile } = mountPrefixes();
  const mounted = new Set();
  for (const v of varToPrefix.keys()) {
    const f = varToFile.get(v);
    if (f) mounted.add(f);
  }
  return readdirSync(join(SERVER_SRC, "routes"))
    .filter((f) => f.endsWith(".ts") && !isTest(f))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((stem) => !mounted.has(stem))
    .map((stem) => `routes/${stem}.ts`);
}

// ── client call inventory ─────────────────────────────────────────────

function clientCalledPaths() {
  const calls = new Set();
  for (const file of walk(CLIENT_SRC).filter(isSource)) {
    if (isTest(file)) continue;
    const src = stripComments(readFileSync(file, "utf8"));

    // Most call sites are template literals over a module-level base:
    //   const API = "/api/inventory";
    //   fetch(`${API}/ingredients/${id}/usage`)
    // so the literal itself never contains "/api/". Resolve those constants
    // first or nearly every route reads as uncalled.
    const declaration = /const\s+(\w+)\s*=\s*["'`]([^"'`\n]*)["'`]\s*;/g;
    const bases = new Map();
    for (const m of src.matchAll(declaration)) bases.set(m[1], m[2]);

    // Drop the declarations before scanning: `const API = "/api/inventory";`
    // is a base, not a request, and counting it invents a call to a bare
    // prefix that no route serves.
    const body = src.replace(declaration, "");

    // Each quote style scanned separately, so an unbalanced quote in one
    // cannot desynchronise the others.
    for (const re of [/`([^`]*)`/g, /"([^"\n]*)"/g, /'([^'\n]*)'/g]) {
      for (const m of body.matchAll(re)) {
        const resolved = m[1].replace(/\$\{(\w+)\}/g, (whole, name) =>
          bases.has(name) ? bases.get(name) : whole,
        );
        const at = resolved.indexOf("/api/");
        if (at === -1) continue;
        calls.add(normalise(resolved.slice(at).split("?")[0]));
      }
    }
  }
  return [...calls];
}

// ── check 2: client calls that hit nothing ────────────────────────────

/**
 * The precise direction, and the one that caught defect #1: the client called
 * POST /api/compliance/documents/upload and GET /documents/:id/view-url and
 * neither route had ever been written. It compiled, it type-checked, and it
 * 404'd the moment a user clicked.
 */
function checkClientCallsHitARoute() {
  const registered = serverRoutes().map((r) => normalise(r.path));
  const missing = clientCalledPaths()
    .filter((c) => !registered.some((r) => pathsMatch(c, r)))
    .filter((c) => !ALLOWED_ORPHANS.clientCalls.some((a) => a.pattern.test(c)));
  return [...new Set(missing)].sort();
}

// ── check 3 (ADVISORY): routes nobody calls ───────────────────────────

/**
 * Real signal, deliberately NOT part of the exit code.
 *
 * A route can legitimately land ahead of its UI, and some client paths are
 * assembled at runtime (`/documents/${id}/${action}`) in ways no static scan
 * can resolve. Gating on this would train everyone to ignore the whole check,
 * so it prints and does not fail.
 */
function checkRoutes() {
  const called = clientCalledPaths();
  return serverRoutes()
    .filter((route) => {
      const target = normalise(route.path);
      if (called.some((c) => pathsMatch(c, target))) return false;
      return !ALLOWED_ORPHANS.routes.some((a) => a.pattern.test(route.path));
    })
    .map((r) => `${r.method} ${r.path}  (${r.file})`)
    .sort();
}

// ── report ────────────────────────────────────────────────────────────

const orphanComponents = checkComponents();
const missingRoutes = checkClientCallsHitARoute();
const unmounted = unmountedRouters();
const uncalledRoutes = checkRoutes();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ orphanComponents, missingRoutes, unmounted, uncalledRoutes }, null, 2));
  process.exit(orphanComponents.length + missingRoutes.length + unmounted.length > 0 ? 1 : 0);
}

const section = (title, items, hint) => {
  if (!items.length) return;
  console.log(`\n${title}`);
  console.log(hint);
  for (const i of items) console.log(`  - ${i}`);
};

section(
  `Components no production file imports (${orphanComponents.length})`,
  orphanComponents,
  "  Nothing mounts these, so no user can reach them. Wire them up, or delete them.",
);
section(
  `Client calls a path no server route matches (${missingRoutes.length})`,
  missingRoutes,
  "  These 404 in production the moment a user triggers them.",
);
section(
  `Routers never mounted in index.ts (${unmounted.length})`,
  unmounted,
  "  Every route inside these is a 404 in production.",
);

if (uncalledRoutes.length) {
  console.log(`\nADVISORY — routes with no client caller (${uncalledRoutes.length})`);
  console.log("  Not a failure. Some are call sites assembled at runtime that this scan");
  console.log("  cannot resolve; the rest are dead code or a UI nobody built. Worth a read.");
  for (const r of uncalledRoutes) console.log(`  - ${r}`);
}

const blocking = orphanComponents.length + missingRoutes.length + unmounted.length;
console.log(
  blocking === 0
    ? "\nReachability: OK — every component is imported, every client call hits a real route, every router is mounted."
    : `\nReachability: ${blocking} unreachable item(s). If one is deliberate, add it to ALLOWED_ORPHANS with a reason.`,
);

process.exit(blocking > 0 ? 1 : 0);
