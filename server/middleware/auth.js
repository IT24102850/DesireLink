import { prisma } from "../db.js";
import { config } from "../config.js";
import { randomToken, sha256 } from "../lib/security.js";
import { fail } from "../lib/errors.js";

const DAY = 86_400_000;

function cookieOpts() {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionDays * DAY,
  };
}

export async function createSession(res, user, req) {
  const token = randomToken();
  await prisma.session.create({
    data: {
      id: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + config.sessionDays * DAY),
      userAgent: String(req.get("user-agent") || "").slice(0, 200),
    },
  });
  res.cookie(config.cookieName, token, cookieOpts());
}

export async function destroySession(req, res) {
  const token = req.cookies?.[config.cookieName];
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  res.clearCookie(config.cookieName, { ...cookieOpts(), maxAge: undefined });
}

/** Loads req.user from the session cookie (if any). Never rejects. */
export async function loadSession(req, res, next) {
  const token = req.cookies?.[config.cookieName];
  if (!token || token.length > 100) return next();
  const id = sha256(token);
  const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.isBanned) {
    if (session) await prisma.session.delete({ where: { id } }).catch(() => {});
    // Set-Cookie only on /api/auth/* (never CDN-cached); a stale cookie elsewhere is harmless.
    if (req.originalUrl.startsWith("/api/auth/")) res.clearCookie(config.cookieName, { ...cookieOpts(), maxAge: undefined });
    return next();
  }
  req.user = session.user;
  req.session = { id, token, lastSeenAt: session.lastSeenAt };
  next();
}

/**
 * Sliding expiry, written at most once an hour. Only called from
 * GET /api/auth/me (never CDN-cached), so a Set-Cookie can never end up on a
 * publicly cacheable response such as the ad list or a photo.
 */
export async function touchSession(req, res) {
  const s = req.session;
  if (!s || Date.now() - s.lastSeenAt.getTime() < 3_600_000) return;
  await prisma.session.update({
    where: { id: s.id },
    data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.sessionDays * DAY) },
  });
  res.cookie(config.cookieName, s.token, cookieOpts());
}

export function requireAuth(req, _res, next) {
  if (!req.user) fail("AUTH_REQUIRED", 401);
  next();
}

export const requireRole = (role) => (req, _res, next) => {
  if (!req.user) fail("AUTH_REQUIRED", 401);
  if (req.user.role !== role) fail("FORBIDDEN", 403);
  next();
};

export function requireEmailVerified(req, _res, next) {
  if (!req.user?.emailVerifiedAt) fail("EMAIL_NOT_VERIFIED", 403);
  next();
}

/**
 * CSRF defence for cookie auth: state-changing requests must come from our
 * own origin. SameSite=Lax already blocks most cross-site posts; this closes
 * the rest (old browsers, same-site subdomains).
 */
export function sameOrigin(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  const allowed = new URL(config.appUrl).origin;
  if (origin && origin !== allowed && !(!config.isProd && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    fail("BAD_ORIGIN", 403);
  }
  if (!origin && req.get("x-requested-with") !== "fetch") fail("BAD_ORIGIN", 403);
  next();
}

export const publicUser = (u) =>
  u && {
    id: u.id,
    email: u.email,
    phone: u.phone,
    role: u.role,
    locale: u.locale,
    emailVerified: Boolean(u.emailVerifiedAt),
  };
