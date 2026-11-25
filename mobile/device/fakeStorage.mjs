/* global process, setTimeout, Buffer -- runs in the API server's Node, not on the phone */
/**
 * A stand-in for the file store (Cloudinary) behind compliance documents and profile pictures, for device walks: nothing is sent anywhere.
 * Preloaded into the API server next to fakeModel.mjs (device/screens.sh does it). It patches the SDK the server already loads:
 * an upload gets an id in the folder the server asked for, a delete does nothing, a view link (or a new profile picture) is a public sample picture.
 * FAKE_STORAGE_DIR   when set, each uploaded file is written there, so a person can check what the phone sent (no metadata).
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";

const { v2 } = createRequire(import.meta.url)("cloudinary");
const SAMPLE = "https://res.cloudinary.com/demo/image/upload/sample.jpg";
let n = 0;
v2.uploader.upload_stream = (options, done) => {
  const name = `walk${Date.now().toString(36)}${++n}`;
  const chunks = [];
  const stream = new PassThrough();
  stream.on("data", (c) => chunks.push(c));
  stream.on("end", () => {
    if (process.env.FAKE_STORAGE_DIR) writeFileSync(resolve(process.env.FAKE_STORAGE_DIR, name), Buffer.concat(chunks));
    setTimeout(() => done(undefined, { public_id: `${options.folder}/${name}`, secure_url: SAMPLE }), 1500);
  });
  return stream;
};
v2.uploader.destroy = async () => ({ result: "ok" });
v2.utils.private_download_url = () => SAMPLE;
