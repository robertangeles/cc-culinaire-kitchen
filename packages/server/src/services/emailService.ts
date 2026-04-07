/**
 * @module services/emailService
 *
 * Email delivery service using Resend. Handles sending verification
 * emails and other transactional messages.
 */

import { Resend } from "resend";
import pino from "pino";

const logger = pino({ name: "emailService" });

let resend: Resend | null = null;

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — email sending is disabled");
    return null;
  }
  if (!resend) {
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "noreply@culinaire.kitchen";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

/**
 * Sends an email verification link to a newly registered user.
 */
export async function sendVerificationEmail(
  email: string,
  name: string,
  token: string,
) {
  const verifyUrl = `${CLIENT_URL}/verify-email?token=${token}`;

  const client = getResend();
  if (!client) return;

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Verify your email — CulinAIre Kitchen",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #292524; margin-bottom: 8px;">Welcome to CulinAIre Kitchen</h2>
        <p style="color: #57534e; font-size: 15px;">Hi ${name},</p>
        <p style="color: #57534e; font-size: 15px;">
          Please verify your email address by clicking the button below.
          This link expires in 24 hours.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${verifyUrl}"
             style="display: inline-block; background-color: #b45309; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Verify Email
          </a>
        </div>
        <p style="color: #a8a29e; font-size: 13px;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${verifyUrl}" style="color: #b45309; word-break: break-all;">${verifyUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px;">
          If you didn't create an account, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error }, "Failed to send verification email");
  }
}

/**
 * Sends a direct email from an admin to a user.
 *
 * @param to      - Recipient email address.
 * @param subject - Email subject line.
 * @param body    - HTML email body content.
 * @returns `{ sent: true }` on success, `{ sent: false, error: string }` on failure.
 */
export async function sendDirectEmail(
  to: string,
  subject: string,
  body: string,
): Promise<{ sent: boolean; error?: string }> {
  const client = getResend();
  if (!client) return { sent: false, error: "Email service not configured (RESEND_API_KEY missing)" };

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        ${body}
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px;">
          Sent from CulinAIre Kitchen
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error, to }, "Failed to send direct email");
    return { sent: false, error: error.message };
  }

  return { sent: true };
}

/**
 * Sends a password reset link to the user.
 */
export async function sendPasswordResetEmail(
  email: string,
  name: string,
  token: string,
): Promise<{ sent: boolean; error?: string }> {
  const resetUrl = `${CLIENT_URL}/reset-password?token=${token}`;

  const client = getResend();
  if (!client) return { sent: false, error: "Email service not configured (RESEND_API_KEY missing)" };

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: "Reset your password — CulinAIre Kitchen",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h2 style="color: #292524; margin-bottom: 8px;">Password Reset</h2>
        <p style="color: #57534e; font-size: 15px;">Hi ${name},</p>
        <p style="color: #57534e; font-size: 15px;">
          We received a request to reset your password. Click the button below
          to choose a new one. This link expires in 1 hour.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}"
             style="display: inline-block; background-color: #b45309; color: white; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Reset Password
          </a>
        </div>
        <p style="color: #a8a29e; font-size: 13px;">
          If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${resetUrl}" style="color: #b45309; word-break: break-all;">${resetUrl}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #e7e5e4; margin: 24px 0;" />
        <p style="color: #a8a29e; font-size: 12px;">
          If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
  });

  if (error) {
    logger.error({ error, email }, "Failed to send password reset email");
    return { sent: false, error: error.message };
  }

  return { sent: true };
}

// ---------------------------------------------------------------------------
// Recipe email sharing
// ---------------------------------------------------------------------------

/** Full recipe data for email — mirrors RecipeData from RecipeCard. */
interface RecipeEmailData {
  name: string;
  description: string;
  hookLine?: string;
  yield: string;
  prepTime: string;
  cookTime: string;
  difficulty: string;
  temperature?: string;
  glassware?: string;
  garnish?: string;
  ingredients: { amount: string; unit: string; name: string; note?: string }[];
  steps: { step: number; instruction: string }[];
  proTips?: string[];
  allergenNote: string;
  confidenceNote?: string;
  whyThisWorks?: string;
  theResult?: string;
  flavorBalance?: Record<string, { score: number; description: string }>;
  storageAndSafety?: string;
  platingGuide?: string;
  storyBehindTheDish?: string;
  textureContrast?: string;
  criticalTemperatures?: string;
  makeAheadComponents?: string[];
  winePairing?: { primary: { wine: string; why: string }; alternatives?: { wine: string; why: string }[] };
  // Spirits
  abv?: string;
  standardDrinks?: string;
  buildTime?: string;
  ice?: string;
  venueType?: string;
  batchSpec?: { servings: number | string; components: string[]; storage: string; toServe: string };
  variations?: { name: string; description: string; specAdjustment?: string }[];
  foodPairing?: { primary: { dish: string; why: string }; alternatives?: { dish: string; why: string }[] };
  hashtags?: string[];
}

/**
 * Sends a beautifully formatted recipe email with inline hero image.
 */
export async function sendRecipeEmail(
  to: string,
  recipeData: RecipeEmailData,
  imageUrl: string | null,
  slug: string | null,
  recipeId: string,
): Promise<{ sent: boolean; error?: string }> {
  const client = getResend();
  if (!client) return { sent: false, error: "Email service not configured" };

  const recipeUrl = `${CLIENT_URL}/kitchen-shelf/${slug ?? recipeId}`;

  const s = (label: string, content: string) =>
    `<div style="margin:20px 0;"><p style="color:#44403c;font-size:13px;font-weight:600;margin:0 0 6px;">${label}</p><p style="color:#57534e;font-size:14px;line-height:1.6;margin:0;">${content}</p></div>`;

  const section = (label: string, items: string) =>
    `<h2 style="color:#292524;font-size:18px;margin:24px 0 12px;border-bottom:2px solid #d97706;padding-bottom:8px;">${label}</h2>${items}`;

  const ingredientsHtml = recipeData.ingredients
    .map((i) => `<li style="color:#57534e;font-size:14px;margin-bottom:6px;"><strong>${i.amount} ${i.unit}</strong> ${i.name}${i.note ? ` <em style="color:#a8a29e;">(${i.note})</em>` : ""}</li>`)
    .join("");

  const stepsHtml = recipeData.steps
    .map((st) => `<li style="color:#57534e;font-size:14px;margin-bottom:12px;line-height:1.6;"><strong>Step ${st.step}.</strong> ${st.instruction}</li>`)
    .join("");

  const proTipsHtml = recipeData.proTips?.length
    ? `<div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#44403c;font-size:13px;font-weight:600;margin:0 0 8px;">Pro Tips</p>
        ${recipeData.proTips.map((t) => `<p style="color:#57534e;font-size:13px;margin:0 0 4px;">• ${t}</p>`).join("")}
       </div>` : "";

  const whyHtml = recipeData.whyThisWorks ? s("Why This Works", recipeData.whyThisWorks) : "";
  const resultHtml = recipeData.theResult ? s("The Result", recipeData.theResult) : "";
  const storyHtml = recipeData.storyBehindTheDish ? s("The Story", recipeData.storyBehindTheDish) : "";
  const platingHtml = recipeData.platingGuide ? s("Plating Guide", recipeData.platingGuide) : "";
  const storageHtml = recipeData.storageAndSafety ? s("Storage & Food Safety", recipeData.storageAndSafety) : "";
  const textureHtml = recipeData.textureContrast ? s("Texture Contrast", recipeData.textureContrast) : "";

  const criticalTempHtml = recipeData.criticalTemperatures
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px 16px;margin:20px 0;">
        <p style="color:#991b1b;font-size:13px;font-weight:600;margin:0 0 4px;">Critical Temperatures</p>
        <p style="color:#b91c1c;font-size:13px;margin:0;">${recipeData.criticalTemperatures}</p>
       </div>` : "";

  const makeAheadHtml = recipeData.makeAheadComponents?.length
    ? `<div style="margin:20px 0;"><p style="color:#44403c;font-size:13px;font-weight:600;margin:0 0 6px;">Make-Ahead Components</p>
        ${recipeData.makeAheadComponents.map((c) => `<p style="color:#57534e;font-size:13px;margin:0 0 3px;">• ${c}</p>`).join("")}
       </div>` : "";

  const flavorHtml = recipeData.flavorBalance
    ? `<div style="margin:20px 0;"><p style="color:#44403c;font-size:13px;font-weight:600;margin:0 0 8px;">Flavor Balance</p>
        ${Object.entries(recipeData.flavorBalance).map(([taste, data]) =>
          `<p style="color:#57534e;font-size:13px;margin:0 0 4px;"><strong>${taste.charAt(0).toUpperCase() + taste.slice(1)}</strong> (${data.score}/10): ${data.description}</p>`
        ).join("")}</div>` : "";

  const winePairingHtml = recipeData.winePairing
    ? `<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#6b21a8;font-size:13px;font-weight:600;margin:0 0 6px;">Wine Pairing</p>
        <p style="color:#7c3aed;font-size:14px;font-weight:500;margin:0 0 4px;">${recipeData.winePairing.primary.wine}</p>
        <p style="color:#6d28d9;font-size:13px;margin:0;">${recipeData.winePairing.primary.why}</p>
        ${recipeData.winePairing.alternatives?.map((a) => `<p style="color:#7c3aed;font-size:12px;margin:6px 0 0;"><strong>${a.wine}</strong> — ${a.why}</p>`).join("") ?? ""}
       </div>` : "";

  // Spirits-specific
  const batchHtml = recipeData.batchSpec
    ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin:20px 0;">
        <p style="color:#92400e;font-size:13px;font-weight:600;margin:0 0 8px;">Batch Spec (${recipeData.batchSpec.servings} Servings)</p>
        ${recipeData.batchSpec.components.map((c) => `<p style="color:#a16207;font-size:13px;margin:0 0 3px;">• ${c}</p>`).join("")}
        <p style="color:#a16207;font-size:12px;margin:8px 0 0;"><strong>Storage:</strong> ${recipeData.batchSpec.storage}</p>
        <p style="color:#a16207;font-size:12px;margin:4px 0 0;"><strong>To serve:</strong> ${recipeData.batchSpec.toServe}</p>
       </div>` : "";

  const variationsHtml = recipeData.variations?.length
    ? `<div style="margin:20px 0;"><p style="color:#44403c;font-size:13px;font-weight:600;margin:0 0 8px;">Variations</p>
        ${recipeData.variations.map((v) => `<p style="color:#57534e;font-size:13px;margin:0 0 6px;"><strong>${v.name}</strong>: ${v.description}${v.specAdjustment ? ` <em>(${v.specAdjustment})</em>` : ""}</p>`).join("")}
       </div>` : "";

  const foodPairingHtml = recipeData.foodPairing
    ? `<div style="margin:20px 0;"><p style="color:#44403c;font-size:13px;font-weight:600;margin:0 0 6px;">Food Pairing</p>
        <p style="color:#57534e;font-size:14px;margin:0 0 4px;"><strong>${recipeData.foodPairing.primary.dish}</strong></p>
        <p style="color:#57534e;font-size:13px;margin:0;">${recipeData.foodPairing.primary.why}</p>
        ${recipeData.foodPairing.alternatives?.map((a) => `<p style="color:#78716c;font-size:12px;margin:6px 0 0;"><strong>${a.dish}</strong> — ${a.why}</p>`).join("") ?? ""}
       </div>` : "";

  const spiritsMetaHtml = (recipeData.abv || recipeData.buildTime || recipeData.venueType)
    ? `<p style="color:#78716c;font-size:12px;margin:12px 0;">${[
        recipeData.abv ? `ABV: ${recipeData.abv}` : "",
        recipeData.standardDrinks ?? "",
        recipeData.buildTime ? `Build: ${recipeData.buildTime}` : "",
        recipeData.venueType ?? "",
      ].filter(Boolean).join(" | ")}</p>` : "";

  const hashtagsHtml = recipeData.hashtags?.length
    ? `<p style="color:#a8a29e;font-size:12px;margin:16px 0 0;">${recipeData.hashtags.join("  ")}</p>` : "";

  // Embed hero image via Resend's CID inline attachment.
  // Image URLs from our server are relative (/uploads/generated/...) so we
  // need the full URL. Resend's `path` requires http(s).
  // If the URL is relative, we fetch the image ourselves and send as base64 content.
  let heroImgTag = "";
  const attachments: any[] = [];

  if (imageUrl) {
    try {
      if (imageUrl.startsWith("http")) {
        // External URL — let Resend fetch it
        attachments.push({ path: imageUrl, filename: "recipe-hero.jpg", contentId: "hero_image" });
      } else {
        // Local/relative URL — fetch from our own server and embed as base64
        const fullUrl = `http://localhost:${process.env.PORT ?? 3009}${imageUrl}`;
        const imgRes = await fetch(fullUrl);
        if (imgRes.ok) {
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          attachments.push({
            filename: "recipe-hero.jpg",
            content: buffer,
            contentId: "hero_image",
          });
        }
      }
      if (attachments.length > 0) {
        heroImgTag = `<img src="cid:hero_image" alt="${recipeData.name}" style="width:100%;max-width:600px;border-radius:8px;margin-bottom:24px;" />`;
      }
    } catch (err) {
      logger.warn({ err, imageUrl }, "Failed to attach hero image to recipe email");
    }
  }

  // Extra meta for spirits/patisserie
  const extraMeta = [
    recipeData.temperature ? `<strong>Oven:</strong> ${recipeData.temperature}` : "",
    recipeData.glassware ? `<strong>Glass:</strong> ${recipeData.glassware}` : "",
    recipeData.ice ? `<strong>Ice:</strong> ${recipeData.ice}` : "",
    recipeData.garnish ? `<strong>Garnish:</strong> ${recipeData.garnish}` : "",
  ].filter(Boolean).join(" &nbsp;|&nbsp; ");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      ${heroImgTag}
      <h1 style="color:#292524;font-size:24px;margin:0 0 8px;line-height:1.3;">${recipeData.name}</h1>
      ${recipeData.hookLine ? `<p style="color:#92400e;font-size:15px;font-style:italic;margin:0 0 16px;">"${recipeData.hookLine}"</p>` : ""}
      <p style="color:#57534e;font-size:15px;line-height:1.6;margin:0 0 20px;">${recipeData.description}</p>

      <!-- Meta strip -->
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;padding:12px 16px;margin:0 0 24px;">
        <p style="color:#78716c;font-size:13px;margin:0;">
          <strong>Prep:</strong> ${recipeData.prepTime} &nbsp;|&nbsp;
          <strong>Cook:</strong> ${recipeData.cookTime} &nbsp;|&nbsp;
          <strong>${recipeData.yield}</strong> &nbsp;|&nbsp;
          <strong style="text-transform:capitalize;">${recipeData.difficulty}</strong>
        </p>
        ${extraMeta ? `<p style="color:#78716c;font-size:13px;margin:8px 0 0;">${extraMeta}</p>` : ""}
      </div>

      ${spiritsMetaHtml}

      ${section("Ingredients", `<ul style="padding-left:20px;margin:0 0 24px;">${ingredientsHtml}</ul>`)}
      ${section("Method", `<ol style="padding-left:20px;margin:0 0 24px;">${stepsHtml}</ol>`)}

      ${proTipsHtml}
      ${whyHtml}
      ${resultHtml}
      ${flavorHtml}
      ${textureHtml}
      ${criticalTempHtml}
      ${makeAheadHtml}
      ${winePairingHtml}
      ${batchHtml}
      ${variationsHtml}
      ${foodPairingHtml}
      ${storyHtml}
      ${platingHtml}
      ${storageHtml}

      <!-- Allergen note -->
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 16px;margin:24px 0;">
        <p style="color:#92400e;font-size:13px;margin:0;">${recipeData.allergenNote}</p>
      </div>

      ${recipeData.confidenceNote ? `<p style="color:#a8a29e;font-size:11px;font-style:italic;margin:0 0 16px;">${recipeData.confidenceNote}</p>` : ""}
      ${hashtagsHtml}

      <!-- CTA -->
      <div style="text-align:center;margin:32px 0;">
        <a href="${recipeUrl}" style="display:inline-block;background-color:#b45309;color:white;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;font-size:15px;">View Full Recipe</a>
      </div>

      <!-- Disclaimer -->
      <p style="color:#a8a29e;font-size:11px;line-height:1.5;margin:24px 0 0;">
        All recipes are AI-generated and should be reviewed by a qualified professional before use.
        CulinAIre Kitchen does not guarantee outcomes, nutritional accuracy, or allergen completeness.
      </p>
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:24px 0;" />
      <p style="color:#a8a29e;font-size:12px;text-align:center;">
        Shared from <a href="${CLIENT_URL}" style="color:#b45309;text-decoration:none;">CulinAIre Kitchen</a>
      </p>
    </div>
  `;

  const { error } = await client.emails.send({
    from: FROM_EMAIL,
    to,
    subject: `${recipeData.name} — CulinAIre Kitchen`,
    html,
    ...(attachments.length > 0 ? { attachments: attachments as any } : {}),
  });

  if (error) {
    logger.error({ error, to }, "Failed to send recipe email");
    return { sent: false, error: error.message };
  }

  logger.info({ to, recipeName: recipeData.name }, "Recipe email sent");
  return { sent: true };
}
