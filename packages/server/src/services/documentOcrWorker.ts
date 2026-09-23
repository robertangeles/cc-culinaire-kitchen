/**
 * @module services/documentOcrWorker
 *
 * Runs inside a dedicated `worker_threads` Worker, spawned by
 * documentOcrService.ts. Tesseract.js's own worker/WASM initialisation has
 * been observed to block its host thread's event loop hard enough that a
 * `Promise.race` timeout on that same thread never fires — the timeout
 * timer itself never gets a turn. Running it in a separate OS thread means
 * the caller can always recover by calling `.terminate()`, which kills this
 * thread outright regardless of what it's stuck doing.
 *
 * Protocol: caller posts `{ id, buffer }`, this thread posts back exactly
 * one of `{ id, text }` or `{ id, error }`. One tesseract worker is created
 * lazily and reused for the life of this thread.
 */

import { parentPort } from "node:worker_threads";

interface Job {
  id: number;
  buffer: Buffer;
}

interface OcrWorker {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
}

if (!parentPort) {
  throw new Error("documentOcrWorker must be run as a worker_threads Worker");
}

let worker: OcrWorker | null = null;

async function getWorker(): Promise<OcrWorker> {
  if (worker) return worker;
  const { createWorker } = await import("tesseract.js");
  worker = (await createWorker("eng")) as unknown as OcrWorker;
  return worker;
}

parentPort.on("message", async (job: Job) => {
  try {
    const w = await getWorker();
    const result = await w.recognize(job.buffer);
    parentPort!.postMessage({ id: job.id, text: result.data.text ?? "" });
  } catch (err) {
    parentPort!.postMessage({ id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
});
