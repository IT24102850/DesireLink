import express from "express";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import { prisma } from "./db.js";
import { errorHandler } from "./lib/errors.js";
import { safeEqual } from "./lib/security.js";
import { loadSession, sameOrigin } from "./middleware/auth.js";
import authRoutes from "./routes/auth.js";
import verificationRoutes from "./routes/verification.js";
import adRoutes, { media } from "./routes/ads.js";
import adminRoutes from "./routes/admin.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);

  const turnstile = config.turnstile ? ["https://challenges.cloudflare.com"] : [];
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'", ...turnstile],
          "frame-src": [...turnstile],
          "style-src": ["'self'", "'unsafe-inline'"],
          "img-src": ["'self'", "data:", "blob:"],
          "font-src": ["'self'", "data:"],
          "connect-src": ["'self'"],
          "object-src": ["'none'"],
          "base-uri": ["'self'"],
          "form-action": ["'self'"],
          "frame-ancestors": ["'none'"],
          "upgrade-insecure-requests": config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    })
  );
  app.use((_req, res, next) => {
    res.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
    next();
  });
  app.use(compression());
  app.use(cookieParser());
  app.use(express.json({ limit: "32kb" }));

  app.get("/healthz", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Behind Vercel: only accept traffic carrying the shared secret, and take the
  // visitor IP from x-real-ip (set by Vercel, cannot be spoofed by the client).
  if (config.originSecret) {
    app.use((req, res, next) => {
      if (!safeEqual(req.get("x-origin-secret") || "", config.originSecret)) {
        return res.status(403).json({ error: "FORBIDDEN" });
      }
      const ip = (req.get("x-real-ip") || "").trim();
      if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true });
      next();
    });
  }

  app.get("/api/config", (_req, res) => res.json({ turnstileSiteKey: config.turnstile?.siteKey || null }));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  api.use(loadSession, sameOrigin);
  api.use("/auth", authRoutes);
  api.use("/verification", verificationRoutes);
  api.use("/ads", adRoutes);
  api.use("/admin", adminRoutes);
  api.use((_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  app.use("/api", api);
  app.use("/media", loadSession, media);

  // ---- built SPA ---------------------------------------------------------------
  if (fs.existsSync(path.join(config.distDir, "index.html"))) {
    app.use(
      "/assets",
      express.static(path.join(config.distDir, "assets"), { immutable: true, maxAge: "365d", fallthrough: false })
    );
    app.use(express.static(config.distDir, { index: false, maxAge: "1h" }));
    const indexHtml = path.join(config.distDir, "index.html");
    app.get(/^\/(?!api\/|media\/).*/, (_req, res) => {
      res.set("Cache-Control", "no-cache");
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
