import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { pino } from "pino";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config } from "dotenv";
config({ path: "../../.env" });

import { healthRouter } from "./routes/health.js";
import { chatRouter } from "./routes/chat.js";
import { promptsRouter } from "./routes/prompts.js";
import { conversationsRouter } from "./routes/conversations.js";
import { settingsRouter } from "./routes/settings.js";
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
import { knowledgeRouter } from "./routes/knowledge.js";
import { recoverStaleDocuments } from "./services/knowledgeManagementService.js";
import { hydrateEnvFromCredentials } from "./services/credentialService.js";
import { ensureEncryptionKey, ensurePiiKeys } from "./utils/crypto.js";
import { cleanupStaleSessions } from "./services/guestService.js";
import { purgeArchivedRecipes } from "./services/recipePersistenceService.js";
import { getAllSettings } from "./services/settingsService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const log = pino({ transport: { target: "pino-pretty" } });

const app = express();
const port = process.env.PORT ?? 3001;

// Stripe webhook needs raw body — must be before express.json()
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), handleWebhook);

// Trust first proxy (Railway / Nginx) so req.ip returns the real client IP
app.set("trust proxy", 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL ?? "http://localhost:5173",
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => req.path.startsWith("/api/auth/"),
  })
);

// Routes
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/chat", chatRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/conversations", conversationsRouter);
app.use("/api/settings", settingsRouter);
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

// Sitemap
app.use("/sitemap.xml", sitemapRouter);

// Static file serving for uploaded images (favicon, logo)
app.use("/uploads", express.static(join(__dirname, "../../../uploads")));

// ---------------------------------------------------------------------------
// Server-side meta injection for recipe SEO
// In production, intercept /kitchen-shelf/:slug requests and inject
// recipe-specific meta tags (og:title, og:description, og:image, JSON-LD)
// into the HTML before serving — so crawlers see proper SEO data.
// ---------------------------------------------------------------------------
const CLIENT_DIST = join(__dirname, "../../../client/dist");
import { readFile as readFileAsync } from "fs/promises";
import { getRecipe as getRecipeForSeo } from "./services/recipePersistenceService.js";

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

    const jsonLd = JSON.stringify({
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
    });

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

// Serve built client SPA in production (catch-all for client routes)
app.use(express.static(CLIENT_DIST));
app.use((req, res, next) => {
  // Only serve index.html for non-API HTML requests (SPA fallback)
  if (req.path.startsWith("/api/") || req.method !== "GET") return next();
  if (!req.headers.accept?.includes("text/html")) return next();
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
hydrateEnvFromCredentials().then(() => {
  recoverStaleDocuments()
    .then((count) => {
      if (count > 0) log.info({ count }, "Recovered stale knowledge documents");
    })
    .catch((err) => {
      log.warn({ err }, "Knowledge recovery check failed (non-fatal)");
    })
    .then(() => {
    const server = app.listen(port, () => {
      log.info(`CulinAIre Kitchen server running on http://localhost:${port}`);
      log.info(`AI Provider: ${process.env.AI_PROVIDER ?? "anthropic"}`);

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

      // Graceful shutdown: close server and release port on termination signals
      function shutdown(signal: string) {
        log.info(`${signal} received — shutting down`);
        clearInterval(cleanupInterval);
        clearInterval(purgeInterval);
        server.close(() => {
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
