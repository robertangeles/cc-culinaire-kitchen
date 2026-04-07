/**
 * @module services/imageService
 *
 * Image generation service routed through OpenRouter.
 * Generates images from text prompts using models like Gemini Flash Image
 * or GPT-5 Image, and stores them via Cloudinary or local disk.
 *
 * The model used is configurable via the `image_generation_model` site setting,
 * defaulting to `google/gemini-2.5-flash-image` (OpenRouter format).
 *
 * Uses the OpenRouter chat completions API with `modalities: ["text", "image"]`.
 * Generated images are returned as base64-encoded data URLs in the response.
 */

import { writeFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";
import pino from "pino";
import { v2 as cloudinary } from "cloudinary";
import { getAllSettings } from "./settingsService.js";

const logger = pino({ name: "imageService" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = join(__dirname, "../../../../uploads/generated");
try { mkdirSync(GENERATED_DIR, { recursive: true }); } catch { /* exists */ }

/** Check if Cloudinary is configured and initialize (reads from DB first, env fallback) */
async function getCloudinary(): Promise<boolean> {
  const { getCredentialValueWithFallback } = await import("./credentialService.js");
  const cloudName = await getCredentialValueWithFallback("CLOUDINARY_CLOUD_NAME");
  const apiKey = await getCredentialValueWithFallback("CLOUDINARY_API_KEY");
  const apiSecret = await getCredentialValueWithFallback("CLOUDINARY_API_SECRET");
  if (!cloudName || !apiKey || !apiSecret) return false;
  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });
  return true;
}

/** Upload a buffer to Cloudinary, returns the secure URL */
async function uploadToCloudinary(buffer: Buffer, folder: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error) reject(error);
        else resolve(result!.secure_url);
      },
    );
    stream.end(buffer);
  });
}

/** Default model when no setting is configured (OpenRouter format). */
const DEFAULT_MODEL = "google/gemini-2.5-flash-image";

export interface GeneratedImage {
  /** Public URL path to the generated image. */
  url: string;
  /** MIME type of the image. */
  mimeType: string;
}

/**
 * Generate an image from a text prompt via OpenRouter.
 *
 * Reads the model name from the `image_generation_model` site setting so
 * admins can switch models without a code change or server restart.
 *
 * @param prompt - The text description of the image to generate.
 * @returns The URL and MIME type of the generated image, or null if unavailable.
 * @throws {Error} If the API call fails.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Image generation is not configured. OPENROUTER_API_KEY is missing.");
  }

  // Read the configured model from site settings
  const settings = await getAllSettings();
  const model = settings.image_generation_model || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.CLIENT_URL ?? "http://localhost:5179",
        "X-Title": "CulinAIre Kitchen",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        modalities: ["text", "image"],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ model, prompt: prompt.slice(0, 100), error: msg }, "OpenRouter image API error");
    throw new Error(`Image generation failed: ${msg}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    logger.error({ model, status: response.status, error: errorBody }, "OpenRouter image API error");
    throw new Error(`Image generation failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: Array<{
          type: string;
          image_url?: { url: string };
          text?: string;
        }> | string;
      };
    }>;
  };

  // Log raw response for debugging — full message keys and structure
  const msg = data.choices?.[0]?.message;
  logger.info({
    rawResponseKeys: Object.keys(data),
    choiceKeys: data.choices?.[0] ? Object.keys(data.choices[0]) : [],
    messageKeys: msg ? Object.keys(msg) : [],
    contentType: msg?.content === null ? "null" : typeof msg?.content,
    fullMessage: JSON.stringify(msg).slice(0, 1000),
  }, "OpenRouter image response structure");

  // Extract image from response — OpenRouter returns images as base64 data URLs
  // in content parts with type "image_url"
  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("No response received from image generation model.");
  }

  // OpenRouter returns images in multiple possible locations:
  // 1. message.images[] — array of base64 data URLs (Gemini models)
  // 2. message.content[] — array of parts with type "image_url" (OpenAI models)
  const images = (message as any).images as string[] | undefined;
  const content = message.content;

  // Collect all image data URLs from either location
  const imageUrls: string[] = [];

  if (Array.isArray(images) && images.length > 0) {
    logger.info({ firstImage: JSON.stringify(images[0]).slice(0, 200), imageType: typeof images[0] }, "images[] structure");
    for (const img of images) {
      if (typeof img === "string") {
        imageUrls.push(img);
      } else if (img && typeof img === "object") {
        const url = (img as any).image_url?.url
          || (img as any).url
          || (img as any).data;
        if (url) { imageUrls.push(url); continue; }
        // Handle { b64_json, content_type } format
        const b64 = (img as any).b64_json;
        const ct = (img as any).content_type ?? "image/png";
        if (b64) imageUrls.push(`data:${ct};base64,${b64}`);
      }
    }
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      const url = part.image_url?.url
        || (part as any).image?.url
        || ((part.type === "image_url" || part.type === "image") && (part as any).url);
      if (url) imageUrls.push(url);
    }
  }

  if (imageUrls.length === 0) {
    logger.warn({ hasImages: !!images, contentType: typeof content }, "No image data found in response");
    throw new Error("The model did not generate an image. Try rephrasing your prompt.");
  }

  for (const dataUrl of imageUrls) {
    // Parse data URL: "data:image/png;base64,iVBOR..."
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
    if (!match) {
      logger.warn({ url: dataUrl.slice(0, 50) }, "Unexpected image URL format");
      continue;
    }

    const mimeType = match[1];
    const base64Data = match[2];
    const buffer = Buffer.from(base64Data, "base64");

    // Try Cloudinary first, fall back to local disk
    let url: string;
    if (await getCloudinary()) {
      try {
        url = await uploadToCloudinary(buffer, "culinaire/recipes");
        logger.info({ url, model, mimeType, sizeBytes: buffer.length }, "Image uploaded to Cloudinary");
      } catch (err) {
        logger.warn({ err }, "Cloudinary upload failed, falling back to local disk");
        const extension = mimeType.includes("jpeg") ? ".jpg" : ".png";
        const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
        await writeFile(join(GENERATED_DIR, filename), buffer);
        url = `/uploads/generated/${filename}`;
      }
    } else {
      const extension = mimeType.includes("jpeg") ? ".jpg" : ".png";
      const filename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`;
      await writeFile(join(GENERATED_DIR, filename), buffer);
      url = `/uploads/generated/${filename}`;
      logger.info({ url, model, mimeType, sizeBytes: buffer.length }, "Image saved locally (Cloudinary not configured)");
    }

    return { url, mimeType };
  }

  throw new Error("The model did not generate an image. Try rephrasing your prompt.");
}
