import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env;
const isProd = env.NODE_ENV === "production";

function required(name, { minLength = 1 } = {}) {
  const v = env[name];
  if (!v || v.length < minLength) {
    throw new Error(`Missing or too-short environment variable ${name} (min length ${minLength}). See .env.example.`);
  }
  return v;
}

// 32-byte key as 64 hex chars (npm run gen-secrets) or base64 (Render's generateValue).
function key32(name) {
  const v = required(name).trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, "hex");
  if (/^[A-Za-z0-9+/_-]{42,44}={0,2}$/.test(v)) {
    const b = Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (b.length === 32) return b;
  }
  throw new Error(`${name} must be 32 bytes: 64 hex chars or base64. Generate with: npm run gen-secrets`);
}

export const config = {
  root,
  isProd,
  port: Number(env.PORT || 4000),
  appUrl: (env.APP_URL || "http://localhost:5173").replace(/\/$/, ""),
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : isProd ? 1 : false,
  dataDir: path.resolve(root, env.DATA_DIR || "data"),
  distDir: path.resolve(root, "dist"),

  nicEncKey: key32("NIC_ENC_KEY"),
  hmacKey: key32("HMAC_KEY"),

  // When the app sits behind Vercel (or another CDN) that injects x-origin-secret,
  // requests without it are rejected and the visitor IP is read from x-real-ip.
  originSecret: env.ORIGIN_SECRET || null,

  sessionDays: Number(env.SESSION_DAYS || 14),
  cookieName: isProd ? "__Host-dl_sid" : "dl_sid",

  smtp: env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT || 587),
        secure: env.SMTP_SECURE === "true",
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      }
    : null,
  mailFrom: env.MAIL_FROM || "DesireLink <no-reply@localhost>",
  allowConsoleMail: env.ALLOW_CONSOLE_MAIL === "true" || !isProd,

  turnstile: env.TURNSTILE_SECRET_KEY
    ? { siteKey: required("TURNSTILE_SITE_KEY"), secret: env.TURNSTILE_SECRET_KEY }
    : null,

  bootstrapAdmin: env.ADMIN_EMAIL && env.ADMIN_PASSWORD ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } : null,
};

if (isProd && !config.smtp && !config.allowConsoleMail) {
  throw new Error("SMTP_HOST is required in production (email codes and notifications). Set ALLOW_CONSOLE_MAIL=true only for a private staging server.");
}
if (config.originSecret && config.originSecret.length < 32) {
  throw new Error("ORIGIN_SECRET must be at least 32 characters.");
}
if (isProd && !config.appUrl.startsWith("https://")) {
  throw new Error("APP_URL must be https:// in production (secure cookies).");
}
