/**
 * @module vite.config
 *
 * Vite build configuration for the CulinAIre Kitchen client.
 * Configures React + Tailwind plugins, dev-server proxy to the Express
 * backend, and injects the monorepo root `package.json` version as the
 * global `__APP_VERSION__` constant available at build time.
 */

import { readFileSync } from "fs";
import type { ServerResponse } from "http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    /** Injected at build time from the root package.json `version` field. */
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5179,
    strictPort: true,
    proxy: {
      // Streaming chat endpoint — bypass http-proxy buffering with manual pipe
      "/api/chat": {
        target: "http://localhost:3009",
        changeOrigin: true,
        selfHandleResponse: true,
        proxyTimeout: 120000,
        timeout: 120000,
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            console.error("[proxy /api/chat] error:", err.message);
            const sres = res as ServerResponse;
            if (!sres.headersSent) {
              sres.writeHead(500, { "Content-Type": "application/json" });
              sres.end(JSON.stringify({ error: "Stream proxy error" }));
            }
          });
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("Accept-Encoding");
          });
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            // Forward all response headers from the backend
            Object.entries(proxyRes.headers).forEach(([key, value]) => {
              if (value !== undefined) res.setHeader(key, value);
            });
            res.setHeader("x-accel-buffering", "no");
            res.setHeader("cache-control", "no-cache");
            res.statusCode = proxyRes.statusCode ?? 200;
            // Pipe directly — avoids http-proxy internal buffering
            proxyRes.pipe(res, { end: true });
          });
        },
      },
      // All other API routes — standard proxy
      "/api": {
        target: "http://localhost:3009",
        changeOrigin: true,
        configure: (proxy) => {
          // Suppress ECONNREFUSED noise while the server is starting up
          proxy.on("error", () => {});
        },
      },
      "/uploads": {
        target: "http://localhost:3009",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("error", () => {});
        },
      },
      // Socket.io — proxy WebSocket upgrade + polling fallback
      "/socket.io": {
        target: "http://localhost:3009",
        changeOrigin: true,
        ws: true,
        configure: (proxy) => {
          proxy.on("error", () => {});
        },
      },
    },
  },
});
