import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { pino } from "pino";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

import { healthRouter } from "./routes/health.js";
import { chatRouter } from "./routes/chat.js";
import { promptsRouter } from "./routes/prompts.js";
import { mobilePromptsRouter } from "./routes/mobilePrompts.js";
import { mobileRagRouter } from "./routes/mobileRag.js";
import { mobileFeatureFlagsRouter } from "./routes/mobileFeatureFlags.js";
import { mobileFeedbackRouter } from "./routes/mobileFeedback.js";
import {
  assertFeedbackEmailConfig,
  processPendingFeedbackEmails,
} from "./services/feedbackService.js";
import { conversationsRouter } from "./routes/conversations.js";
import { settingsRouter } from "./routes/settings.js";
import { publicSitePagesRouter, adminSitePagesRouter } from "./routes/sitePages.js";
import { ensureSeededPages } from "./services/sitePageService.js";
import authRouter from "./routes/auth.js";
import usersRouter from "./routes/users.js";
import organisationsRouter from "./routes/organisations.js";
import rolesRouter from "./routes/roles.js";
import permissionsRouter from "./routes/permissions.js";
import stripeRouter from "./routes/stripe.js";
import { credentialsRouter } from "./routes/credentials.js";
import guestRouter from "./routes/guest.js";
import { sitemapRouter } from "./routes/sitemap.js";
import { recipesRouter } from "./routes/recipes.js";
import { personalisationOptionsRouter, adminPersonalisationOptionsRouter } from "./routes/personalisationOptions.js";
import { handleWebhook } from "./controllers/stripeController.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { CLIENT_URL, PORT } from "./utils/env.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { modelOptionsRouter } from "./routes/modelOptions.js";
import { recoverStaleDocuments } from "./services/knowledgeManagementService.js";
import { hydrateEnvFromCredentials } from "./services/credentialService.js";
import { ensureEncryptionKey, ensurePiiKeys } from "./utils/crypto.js";
import { cleanupStaleSessions } from "./services/guestService.js";
import { purgeArchivedRecipes } from "./services/recipePersistenceService.js";
import { getAllSettings } from "./services/settingsService.js";
import { sendWeeklyWasteDigests } from "./services/wasteDigestService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const log = pino({ transport: { target: "pino-pretty" } });

const app = express();
const port = PORT;

// Stripe webhook needs raw body — must be before express.json()
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleWebhook);

// Trust first proxy (Railway / Nginx) so req.ip returns the real client IP
app.set("trust proxy", 1);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https://res.cloudinary.com", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      connectSrc: ["'self'", "https://res.cloudinary.com", "wss:", "ws:"],
    },
  },
}));
// Allow the web client (CLIENT_URL) and the native mobile build's webview origins.
// Capacitor 5+ on Android uses `https://localhost`; the legacy scheme is `capacitor://localhost`.
// iOS (deferred) uses `capacitor://localhost` too. Requests with no Origin header (e.g. curl,
// server-to-server) are allowed through — CORS only matters for browser-originated requests.
const ALLOWED_ORIGINS = new Set<string>([
  CLIENT_URL,
  "https://localhost",
  "capacitor://localhost",
]);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/"),
    message: { error: "Too many requests, please try again later." },
  })
);

// Routes
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/mobile/prompts", mobilePromptsRouter);
app.use("/api/mobile/rag", mobileRagRouter);
app.use("/api/mobile/feature-flags", mobileFeatureFlagsRouter);
app.use("/api/mobile/feedback", mobileFeedbackRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/site-pages", publicSitePagesRouter);
app.use("/api/admin/site-pages", adminSitePagesRouter);
app.use("/api/users", usersRouter);
app.use("/api/organisations", organisationsRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/permissions", permissionsRouter);
app.use("/api/stripe", stripeRouter);
app.use("/api/credentials", credentialsRouter);
app.use("/api/guest", guestRouter);
app.use("/api/recipes", recipesRouter);
app.use("/api", personalisationOptionsRouter);
app.use("/api/admin", adminPersonalisationOptionsRouter);
app.use("/api/knowledge", knowledgeRouter);
app.use("/api/model-options", modelOptionsRouter);
app.use("/api/bench", benchRouter);
app.use("/api/menu", menuIntelligenceRouter);
app.use("/api/waste", wasteRouter);
app.use("/api/prep", prepRouter);
app.use("/api/guides", guidesRouter);
app.use("/api/store-locations", storeLocationsRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/internal", internalRouter);
app.use("/api/notifications", notificationsRouter);

// Location context routes are now inside usersRouter (before /:id params)

// Database stats (admin only)
import { authenticate, requireRole } from "./middleware/auth.js";
import { handleDatabaseStats, handleDatabaseQuery } from "./controllers/databaseController.js";
app.get("/api/admin/database/stats", authenticate, requireRole("Administrator"), handleDatabaseStats);
app.post("/api/admin/database/query", authenticate, requireRole("Administrator"), handleDatabaseQuery);

// Sitemap
app.use("/sitemap.xml", sitemapRouter);

// Static file serving for uploaded images (favicon, logo)
// Ensure uploads directory exists (Render has ephemeral filesystem)
import { mkdirSync, readFileSync } from "fs";
const uploadsDir = join(__dirname, "../../../uploads");
try { mkdirSync(uploadsDir, { recursive: true }); } catch { /* already exists */ }
app.use("/uploads", express.static(uploadsDir));

// ---------------------------------------------------------------------------
// Server-side meta injection for recipe SEO
// In production, intercept /kitchen-shelf/:slug requests and inject
// recipe-specific meta tags (og:title, og:description, og:image, JSON-LD)
// into the HTML before serving — so crawlers see proper SEO data.
// ---------------------------------------------------------------------------
const CLIENT_DIST = join(__dirname, "../../client/dist");
import { readFile as readFileAsync } from "fs/promises";
import { getRecipe as getRecipeForSeo } from "./services/recipePersistenceService.js";
import { getRatingsSummary } from "./services/ratingService.js";
import { initBenchSocket } from "./services/benchSocketService.js";
import { benchRouter } from "./routes/bench.js";
import { menuIntelligenceRouter } from "./routes/menuIntelligence.js";
import { wasteRouter } from "./routes/waste.js";
import { prepRouter } from "./routes/prep.js";
import { guidesRouter } from "./routes/guides.js";
import storeLocationsRouter from "./routes/storeLocations.js";
import inventoryRouter from "./routes/inventory.js";
import internalRouter from "./routes/internal.js";
import notificationsRouter from "./routes/notifications.js";

app.get("/kitchen-shelf/:slug", async (req, res, next) => {
  // Only handle HTML requests (not API calls or assets)
  if (req.headers.accept && !req.headers.accept.includes("text/html")) {
    return next();
  }

  try {
    const indexPath = join(CLIENT_DIST, "index.html");
    let html: string;
    try {
      html = await readFileAsync(indexPath, "utf-8");
    } catch {
      // No built client (dev mode) — skip, let Vite handle it
      return next();
    }

    const recipe = await getRecipeForSeo(req.params.slug as string);
    if (!recipe || (!recipe.isPublicInd)) {
      // Not found or not public — serve default HTML, React will handle 404
      res.send(html);
      return;
    }

    const data = recipe.recipeData as Record<string, unknown>;
    const title = `${recipe.title} | CulinAIre Kitchen`;
    const description = ((data.description as string) || "").slice(0, 160);
    const image = recipe.imageUrl || "";
    const url = `${process.env.CLIENT_URL ?? "https://culinaire.kitchen"}/kitchen-shelf/${recipe.slug ?? recipe.recipeId}`;

    // Build ingredient list for JSON-LD
    const ingredients = (data.ingredients as Array<{ amount: string; unit: string; name: string }>) || [];
    const steps = (data.steps as Array<{ step: number; instruction: string }>) || [];

    // Fetch aggregate rating for SEO
    const ratingsSummary = await getRatingsSummary(recipe.recipeId);

    const jsonLdObj: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Recipe",
      name: recipe.title,
      description: data.description,
      image: image || undefined,
      author: { "@type": "Organization", name: "CulinAIre Kitchen" },
      prepTime: `PT${((data.prepTime as string) || "").match(/\d+/)?.[0] ?? "0"}M`,
      cookTime: `PT${((data.cookTime as string) || "").match(/\d+/)?.[0] ?? "0"}M`,
      recipeYield: data.yield,
      recipeIngredient: ingredients.map((i) => `${i.amount} ${i.unit} ${i.name}`),
      recipeInstructions: steps.map((s) => ({ "@type": "HowToStep", position: s.step, text: s.instruction })),
    };

    if (ratingsSummary.count > 0) {
      jsonLdObj.aggregateRating = {
        "@type": "AggregateRating",
        ratingValue: ratingsSummary.average,
        ratingCount: ratingsSummary.count,
        bestRating: 5,
        worstRating: 1,
      };
    }

    const jsonLd = JSON.stringify(jsonLdObj);

    // Replace meta tags in HTML
    html = html
      .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
      .replace(/(<meta\s+name="description"\s+content=")[^"]*"/, `$1${description}"`)
      .replace(/(<meta\s+property="og:title"\s+content=")[^"]*"/, `$1${title}"`)
      .replace(/(<meta\s+property="og:description"\s+content=")[^"]*"/, `$1${description}"`)
      .replace(/(<meta\s+property="og:type"\s+content=")[^"]*"/, `$1article"`)
      .replace(/(<meta\s+property="og:url"\s+content=")[^"]*"/, `$1${url}"`)
      .replace(/(<meta\s+name="twitter:card"\s+content=")[^"]*"/, `$1summary_large_image"`)
      .replace(/(<meta\s+name="twitter:title"\s+content=")[^"]*"/, `$1${title}"`)
      .replace(/(<meta\s+name="twitter:description"\s+content=")[^"]*"/, `$1${description}"`);

    // Inject og:image if recipe has one
    if (image) {
      html = html.replace("</head>", `  <meta property="og:image" content="${image}" />\n  <meta name="twitter:image" content="${image}" />\n</head>`);
    }

    // Replace the Organization JSON-LD with Recipe JSON-LD
    html = html.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">${jsonLd}</script>`,
    );

    res.send(html);
  } catch (err) {
    next();
  }
});

// Landing page SEO meta injection
app.get("/", (req, res, next) => {
  if (!req.headers.accept?.includes("text/html")) return next();
  try {
    const indexPath = join(CLIENT_DIST, "index.html");
    let html = readFileSync(indexPath, "utf-8");

    // Inject landing-page-specific meta tags
    html = html.replace(
      /<title>.*?<\/title>/,
      "<title>CulinAIre Kitchen — The AI-Powered Brain for Your Kitchen</title>",
    );
    html = html.replace(
      /property="og:title" content="[^"]*"/,
      'property="og:title" content="CulinAIre Kitchen — The AI-Powered Brain for Your Kitchen"',
    );
    html = html.replace(
      /property="og:description" content="[^"]*"/,
      'property="og:description" content="Every tool your kitchen needs. AI culinary assistant, inventory, purchasing, menu intelligence, waste tracking — one platform, $97/mo."',
    );
    html = html.replace(
      /name="twitter:title" content="[^"]*"/,
      'name="twitter:title" content="CulinAIre Kitchen — The AI-Powered Brain for Your Kitchen"',
    );
    html = html.replace(
      /name="twitter:description" content="[^"]*"/,
      'name="twitter:description" content="Every tool your kitchen needs. AI culinary assistant, inventory, purchasing, menu intelligence, waste tracking — one platform, $97/mo."',
    );
    html = html.replace(
      /name="description" content="[^"]*"/,
      'name="description" content="Every tool your kitchen needs. AI culinary assistant, inventory, purchasing, menu intelligence, waste tracking — one platform, $97/mo."',
    );

    // Replace Organization JSON-LD with SoftwareApplication
    const landingLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "CulinAIre Kitchen",
      url: "https://culinaire.kitchen",
      description:
        "AI-powered kitchen operations platform for chefs, restaurateurs, and culinary professionals. Inventory, purchasing, menu intelligence, waste tracking, and AI culinary assistant.",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "97.00",
        priceCurrency: "USD",
        priceValidUntil: "2027-12-31",
      },
    });
    html = html.replace(
      /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
      `<script type="application/ld+json">${landingLd}</script>`,
    );

    res.send(html);
  } catch {
    next();
  }
});

// Serve built client SPA in production (catch-all for client routes)
app.use(express.static(CLIENT_DIST));
app.use((req, res, next) => {
  // SPA fallback for any non-API GET that could plausibly want HTML.
  //
  // We serve the SPA shell when the Accept header is text/html (real
  // browsers), */* (curl, PowerShell Invoke-WebRequest, link checkers,
  // Google's Play Console URL validator), or missing entirely (primitive
  // HTTP clients). An explicit non-HTML Accept (application/json,
  // image/*, etc.) falls through to the 404 — those are signals the
  // caller does NOT want an HTML page.
  //
  // Static assets are handled by express.static above, so only paths
  // with no matching asset reach this handler. Returning the SPA HTML
  // for, e.g., a typo'd /missing-asset.png is harmless: the request
  // wasn't for an asset (no Accept: image/*), so HTML is the right
  // answer for "any path the SPA might know about."
  if (req.path.startsWith("/api/") || req.method !== "GET") return next();
  const accept = req.headers.accept ?? "";
  const wantsHtml = accept === "" || accept.includes("text/html") || accept.includes("*/*");
  if (!wantsHtml) return next();
  const indexPath = join(CLIENT_DIST, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) next(); // No built client (dev mode)
  });
});

// Error handler (must be after routes)
app.use(errorHandler);

// Start server: ensure encryption key exists, hydrate credentials, then build index
ensureEncryptionKey();
ensurePiiKeys();
// Fail fast at boot if the feedback inbox isn't configured — silently
// dropping feedback emails would be worse than refusing to start.
assertFeedbackEmailConfig();
hydrateEnvFromCredentials().then(() => {
  recoverStaleDocuments()
    .then((count) => {
      if (count > 0) log.info({ count }, "Recovered stale knowledge documents");
    })
    .catch((err) => {
      log.warn({ err }, "Knowledge recovery check failed (non-fatal)");
    })
    .then(() => {
    const httpServer = createServer(app);
    initBenchSocket(httpServer);
    httpServer.listen(port, () => {
      log.info(`CulinAIre Kitchen server running on http://localhost:${port}`);
      log.info(`AI Model: ${process.env.AI_MODEL ?? "anthropic/claude-sonnet-4-20250514"} (via OpenRouter)`);

      // Idempotent seed for the two reserved site_page slugs (terms + privacy).
      ensureSeededPages().catch((err) => {
        log.warn({ err }, "site_page seed failed (non-fatal)");
      });

      // Periodic guest session cleanup (runs once on start, then every hour)
      async function runGuestCleanup() {
        try {
          const settings = await getAllSettings();
          const idleHours = parseInt(settings.guest_session_idle_hours ?? "24", 10);
          if (idleHours > 0) await cleanupStaleSessions(idleHours);
        } catch (err) {
          log.error(err, "Guest session cleanup failed");
        }
      }
      runGuestCleanup();
      const cleanupInterval = setInterval(runGuestCleanup, 60 * 60 * 1000);

      // Periodic archived recipe purge (runs once on start, then every hour)
      async function runRecipePurge() {
        try {
          const settings = await getAllSettings();
          const days = parseInt(settings.recipe_archive_retention_days ?? "30", 10);
          if (days > 0) await purgeArchivedRecipes(days);
        } catch (err) {
          log.error(err, "Recipe archive purge failed");
        }
      }
      runRecipePurge();
      const purgeInterval = setInterval(runRecipePurge, 60 * 60 * 1000);

      // Mobile feedback email retry — every 5 min. Async by design (per
      // needs-frontend.md): the POST returns 201 the moment the row is
      // inserted; this loop forwards each row to the RESEND_FEEDBACK_INBOX
      // with exponential backoff (15 min × 2^attempts, capped at 5 tries).
      async function runFeedbackEmailRetry() {
        try {
          await processPendingFeedbackEmails();
        } catch (err) {
          log.error({ err }, "Feedback email retry job failed");
        }
      }
      // Defer the first run by 30 s so the server is fully warm before
      // we start hitting Resend.
      setTimeout(runFeedbackEmailRetry, 30_000);
      const feedbackEmailInterval = setInterval(runFeedbackEmailRetry, 5 * 60 * 1000);

      // Weekly waste digest — Sunday 8 PM (check every minute)
      let lastWasteDigestRun = "";
      const wasteDigestInterval = setInterval(async () => {
        const now = new Date();
        // Only fire on Sunday (0) at 20:00, and only once per minute window
        const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
        if (now.getDay() === 0 && now.getHours() === 20 && lastWasteDigestRun !== key) {
          lastWasteDigestRun = key;
          try {
            await sendWeeklyWasteDigests();
          } catch (err) {
            log.error({ err }, "Weekly waste digest failed");
          }
        }
      }, 60_000);

      // Graceful shutdown: close server and release port on termination signals
      function shutdown(signal: string) {
        log.info(`${signal} received — shutting down`);
        clearInterval(cleanupInterval);
        clearInterval(purgeInterval);
        clearInterval(wasteDigestInterval);
        clearInterval(feedbackEmailInterval);
        httpServer.close(() => {
          log.info("Server closed");
          process.exit(0);
        });
        // Force exit if close takes too long
        setTimeout(() => process.exit(1), 5000);
      }
      process.on("SIGINT", () => shutdown("SIGINT"));
      process.on("SIGTERM", () => shutdown("SIGTERM"));
    });
  });
});
