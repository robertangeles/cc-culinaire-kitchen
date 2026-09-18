/**
 * @module services/documentOcrService
 *
 * OCR pre-fill for compliance certificate uploads. Best-effort only: a miss
 * here just means the admin falls through to manual entry, so nothing in
 * this module is allowed to throw or block an upload.
 *
 * extractCertificateFields(buffer) -> recognizeWithTimeout -> parseCertificateText
 *
 * Design notes:
 * - The actual tesseract.js work runs in a dedicated `worker_threads` Worker
 *   (documentOcrWorker.ts), not on this thread. Confirmed by hand: tesseract's
 *   own worker/WASM init can block its host thread's event loop hard enough
 *   that a same-thread `Promise.race` timeout never fires — the timer itself
 *   never gets a turn, and the whole server stops answering requests. Running
 *   it on a separate OS thread means a hang there can be ended with
 *   `.terminate()`, which works regardless of what that thread is stuck on.
 * - ONE warm worker thread, spawned lazily on first call and reused after.
 *   `createWorker()` costs 1-2s cold; paying that once amortises it instead
 *   of eating most of the 5s budget on every request.
 * - Only one recognize() is in flight at a time — every call is funneled
 *   through a one-at-a-time promise queue — two uploads racing each other
 *   queue up instead of both hitting the worker thread together.
 * - Every call still gets a hard 5s ceiling. Timeout, empty text, a worker
 *   error, or unparseable output all resolve to `{}` — never a throw, never
 *   an error surfaced to the user. A timeout terminates the worker thread
 *   and lets the next call spawn a fresh one.
 */

import { Worker } from "node:worker_threads";

export interface OcrResult {
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
}

const OCR_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Warm worker thread + serialising queue
// ---------------------------------------------------------------------------

let warmWorker: Worker | null = null;
let nextJobId = 1;

// In dev this file runs as raw TypeScript under tsx; in prod it runs as
// compiled JS under plain node. A worker_threads Worker does NOT inherit
// tsx's module loader the way a normal `import` does — pointing at the
// (nonexistent, in dev) .js sibling fails silently from the caller's side
// (an 'error' event, never a 'message'), which looks identical to a slow
// OCR call and just eats the 5s timeout on every single request. Dev needs
// the .ts file plus an explicit tsx loader for that thread; prod needs the
// compiled .js sibling with no special loader.
const IS_DEV = import.meta.url.endsWith(".ts");
const WORKER_URL = new URL(IS_DEV ? "./documentOcrWorker.ts" : "./documentOcrWorker.js", import.meta.url);

function getWorkerThread(): Worker {
  if (warmWorker) return warmWorker;
  const worker = new Worker(WORKER_URL, IS_DEV ? { execArgv: ["--import", "tsx"] } : undefined);
  // A crash/exit orphans nothing to clean up — just stop treating it as warm.
  worker.once("exit", () => {
    if (warmWorker === worker) warmWorker = null;
  });
  worker.once("error", () => {
    if (warmWorker === worker) warmWorker = null;
  });
  warmWorker = worker;
  return worker;
}

/** Simple FIFO queue: chains each task onto the last, so only one runs at a time. */
let queue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function recognizeWithTimeout(buffer: Buffer): Promise<string | null> {
  const worker = getWorkerThread();
  const id = nextJobId++;

  return new Promise<string | null>((resolve) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Kills the thread outright — the only thing that reliably works
      // against a hang inside tesseract's own init/recognize call.
      void worker.terminate();
      if (warmWorker === worker) warmWorker = null;
      resolve(null);
    }, OCR_TIMEOUT_MS);

    const onMessage = (msg: { id: number; text?: string; error?: string }) => {
      if (msg.id !== id || settled) return;
      settled = true;
      clearTimeout(timer);
      worker.off("message", onMessage);
      resolve(msg.error ? null : (msg.text ?? null));
    };

    worker.on("message", onMessage);
    worker.postMessage({ id, buffer });
  });
}

/** OCR a certificate image/PDF page and pull out the fields we can find. Never throws. */
export async function extractCertificateFields(buffer: Buffer): Promise<OcrResult> {
  try {
    const text = await enqueue(() => recognizeWithTimeout(buffer));
    if (!text) return {};
    return parseCertificateText(text);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Pure text parsing
// ---------------------------------------------------------------------------

const CERT_NUMBER_PATTERN =
  /(?:certificate\s*(?:no\.?|number)|cert\s*no\.?)[^0-9]{0,10}([0-9][0-9-]*)/i;

const ISSUE_LABEL = /\bissue(?:d)?\b/i;
const EXPIRY_LABEL = /\bexpir|\bvalid\s*(?:until|to)\b/i;

/** Day-first (Australian) numeric date: DD/MM/YYYY or DD-MM-YYYY. */
const NUMERIC_DATE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/;

/** D MMM YYYY / D Month YYYY, e.g. "15 Jun 2026" or "5 June, 2026". */
const TEXT_DATE = /\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/;

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function toIsoDate(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Finds the first date (either format) in `snippet` and returns it as YYYY-MM-DD. */
function findFirstDate(snippet: string): string | null {
  const numeric = NUMERIC_DATE.exec(snippet);
  const text = TEXT_DATE.exec(snippet);

  let match: RegExpExecArray | null;
  let isNumeric: boolean;
  if (numeric && text) {
    isNumeric = numeric.index <= text.index;
    match = isNumeric ? numeric : text;
  } else {
    match = numeric ?? text;
    isNumeric = !!numeric;
  }
  if (!match) return null;

  const day = Number(match[1]);
  const year = Number(match[3]);
  if (isNumeric) {
    return toIsoDate(day, Number(match[2]), year);
  }
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  return toIsoDate(day, month, year);
}

/**
 * Finds `labelPattern` line by line and reads the date that follows it —
 * on the same line after the label (handles "Issued 01/01/24 — Expires
 * 31/12/26" on one line), falling back to the next line (handles label and
 * value split across an OCR'd table row).
 */
function findDateForLabel(text: string, labelPattern: RegExp): string | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = labelPattern.exec(lines[i]);
    if (!match) continue;
    const afterLabel = lines[i].slice(match.index + match[0].length);
    const found = findFirstDate(afterLabel) ?? findFirstDate(lines[i + 1] ?? "");
    if (found) return found;
  }
  return null;
}

/**
 * Pure text -> fields parser, exported for direct unit testing. Never
 * throws — a field it can't find is simply omitted from the result.
 */
export function parseCertificateText(text: string): OcrResult {
  if (!text || !text.trim()) return {};

  const result: OcrResult = {};

  const certMatch = CERT_NUMBER_PATTERN.exec(text);
  if (certMatch) {
    const num = certMatch[1].replace(/-+$/, "");
    if (num) result.documentNumber = num;
  }

  const issueDate = findDateForLabel(text, ISSUE_LABEL);
  if (issueDate) result.issueDate = issueDate;

  const expiryDate = findDateForLabel(text, EXPIRY_LABEL);
  if (expiryDate) result.expiryDate = expiryDate;

  return result;
}
