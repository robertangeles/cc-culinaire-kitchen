/**
 * @module services/imageService
 *
 * Image generation service using Google Gemini API (Nano Banana / Imagen).
 * Generates images from text prompts and stores them in the uploads directory.
 *
 * The model used is configurable via the `image_generation_model` site setting,
 * defaulting to `gemini-2.0-flash-exp-image-generation`.
 *
 * Lazy-initializes the Gemini client so the server doesn't crash if
 * GEMINI_API_KEY is not configured.
 */

import { GoogleGenAI } from "@google/genai";
import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pino from "pino";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "imageService" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "../../../../uploads/generated");
// Ensure directory exists (Render persistent disk may not have subdirectories)
import { mkdirSync } from "fs";
try { mkdirSync(GENERATED_DIR, { recursive: true }); } catch { /* exists */ }

/** Default model when no setting is configured. */
const DEFAULT_MODEL = "gemini-2.0-flash-exp-image-generation";

/** Lazy-initialized Gemini client. */
let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI | null {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logger.warn("GEMINI_API_KEY not configured — image generation unavailable");
    return null;
  }
  client = new GoogleGenAI({ apiKey });
  return client;
}

/**
 * Reset the lazy-initialized Gemini client so the next call to
 * {@link getClient} picks up a new API key from process.env.
 * Called after credential upsert/delete via the admin Integrations panel.
 */
export function resetClient(): void {
  client = null;
}

export interface GeneratedImage {
  /** Public URL path to the generated image. */
  url: string;
  /** MIME type of the image. */
  mimeType: string;
}

/**
 * Generate an image from a text prompt using Google Gemini.
 *
 * Reads the model name from the `image_generation_model` site setting so
 * admins can switch models without a code change or server restart.
 *
 * @param prompt - The text description of the image to generate.
 * @returns The URL and MIME type of the generated image, or null if unavailable.
 * @throws {Error} If the API call fails.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage | null> {
  const ai = getClient();
  if (!ai) {
    throw new Error("Image generation is not configured. GEMINI_API_KEY is missing.");
  }

  // Read the configured model from site settings
  const settings = await getAllSettings();
  const model = settings.image_generation_model || DEFAULT_MODEL;

  // Ensure the generated images directory exists
  await mkdir(GENERATED_DIR, { recursive: true });

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ model, prompt: prompt.slice(0, 100), error: msg }, "Gemini API error");
    throw new Error(`Image generation failed: ${msg}`);
  }

  // Extract image from response parts
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("No response received from image generation model.");
  }

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType ?? "image/png";
      const extension = mimeType.includes("jpeg") ? ".jpg" : ".png";
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
      const filePath = join(GENERATED_DIR, filename);

      // Decode base64 and write to disk
      const buffer = Buffer.from(part.inlineData.data, "base64");
      await writeFile(filePath, buffer);

      const url = `/uploads/generated/${filename}`;
      logger.info({ url, model, mimeType, sizeBytes: buffer.length }, "Image generated");
      return { url, mimeType };
    }
  }

  throw new Error("The model did not generate an image. Try rephrasing your prompt.");
}
