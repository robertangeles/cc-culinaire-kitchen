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
import { handleWebhook } from "./controllers/stripeController.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { buildIndex } from "./services/knowledgeService.js";
import { hydrateEnvFromCredentials } from "./services/credentialService.js";
import { ensureEncryptionKey, ensurePiiKeys } from "./utils/crypto.js";
import { cleanupStaleSessions } from "./services/guestService.js";
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

// Sitemap
app.use("/sitemap.xml", sitemapRouter);

// Static file serving for uploaded images (favicon, logo)
app.use("/uploads", express.static(join(__dirname, "../../../uploads")));

// Error handler (must be after routes)
app.use(errorHandler);

// Start server: ensure encryption key exists, hydrate credentials, then build index
ensureEncryptionKey();
ensurePiiKeys();
hydrateEnvFromCredentials().then(() => {
  buildIndex().then(() => {
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

      // Graceful shutdown: close server and release port on termination signals
      function shutdown(signal: string) {
        log.info(`${signal} received — shutting down`);
        clearInterval(cleanupInterval);
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
