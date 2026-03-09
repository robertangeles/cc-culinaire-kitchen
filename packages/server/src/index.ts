import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { pino } from "pino";
import "dotenv/config";

import { healthRouter } from "./routes/health.js";
import { chatRouter } from "./routes/chat.js";

const log = pino({ transport: { target: "pino-pretty" } });

const app = express();
const port = process.env.PORT ?? 3001;

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173" }));
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

// Routes
app.use("/api/health", healthRouter);
app.use("/api/chat", chatRouter);

app.listen(port, () => {
  log.info(`CulinAIre Kitchen server running on http://localhost:${port}`);
});
