import { Router } from "express";
import type { HealthResponse } from "@culinaire/shared";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  const response: HealthResponse = {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
  res.json(response);
});
