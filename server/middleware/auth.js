import { prisma } from "../db.js";
import { config } from "../config.js";
import { randomToken, sha256 } from "../lib/security.js";
import { fail } from "../lib/errors.js";

const DAY = 86_400_000;
const MIN = 60_000;

// Admin sessions are separate from user sessions: own cookie, SameSite=Strict,
// only valid after TOTP, 30 min idle timeout, 8 h absolute lifetime.
export const ADMIN = {
  cookie: config.isProd ? "__Host-dl_adm" : "dl_adm",
  pendingTtl: 10 * MIN, // password OK, waiting for TOTP
  absoluteTtl: 8 * 60 * MIN,
  idleTimeout: 30 * MIN,
};

function cookieOpts(kind = "USER") {
  return kind === "ADMIN"
    ? { httpOnly: true, secure: config.isProd, sameSite: "strict", path: "/", maxAge: ADMIN.absoluteTtl }
    : { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/", maxAge: config.sessionDays * DAY };
}
const clearOpts = (kind) => ({ ...cookieOpts(kind), maxAge: undefined });

export async function createSession(res, user, req, { kind = "USER", mfaVerified = false, ttlMs } = {}) {
  const token = randomToken();
  const ttl = ttlMs ?? (kind === "ADMIN" ? ADMIN.pendingTtl : config.sessionDays * DAY);
  await prisma.session.create({
    data: {
      id: sha256(token),
      userId: user.id,
      kind,
      mfaVerified,
      expiresAt: new Date(Date.now() + ttl),
      userAgent: String(req.get("user-agent") || "").slice(0, 200),
    },
  });
  res.cookie(kind === "ADMIN" ? ADMIN.cookie : config.cookieName, token, cookieOpts(kind));
  return sha256(token);
}

export async function destroySession(req, res) {
  const token = req.cookies?.[config.cookieName];
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  res.clearCookie(config.cookieName, clearOpts("USER"));
}

export async function destroyAdminSession(req, res) {
  const token = req.cookies?.[ADMIN.cookie];
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  res.clearCookie(ADMIN.cookie, clearOpts("ADMIN"));
}

/** Loads the raw admin session (pending or verified) for the admin-auth routes. */
export async function readAdminSession(req) {
  const token = req.cookies?.[ADMIN.cookie];
  if (!token || token.length > 100) return null;
  const s = await prisma.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!s || s.kind !== "ADMIN") return null;
  const now = Date.now();
  const dead =
    s.expiresAt.getTime() < now ||
    (s.mfaVerified && now - s.lastSeenAt.getTime() > ADMIN.idleTimeout) ||
    s.user.role !== "ADMIN" ||
    s.user.isBanned;
  if (dead) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  return s;
}

/**
 * Loads req.user (public session) and req.adminUser (verified admin session).
 * Never rejects. Set-Cookie is only emitted on /api/auth/* and /api/admin*
 * (never CDN-cached); a stale cookie elsewhere is harmless.
 */
export async function loadSession(req, res, next) {
  const mayClear = /^\/api\/(auth|admin)/.test(req.originalUrl);

  // ---- public user session
  const token = req.cookies?.[config.cookieName];
  if (token && token.length <= 100) {
    const id = sha256(token);
    const session = await prisma.session.findUnique({ where: { id }, include: { user: true } });
    // Admin accounts may not use public sessions at all (forces the admin portal + 2FA).
    const invalid = !session || session.kind !== "USER" || session.expiresAt < new Date() || session.user.isBanned || session.user.role === "ADMIN";
    if (invalid) {
      if (session) await prisma.session.delete({ where: { id } }).catch(() => {});
      if (mayClear) res.clearCookie(config.cookieName, clearOpts("USER"));
    } else {
      req.user = session.user;
      req.session = { id, token, lastSeenAt: session.lastSeenAt };
    }
  }

  // ---- admin session (only counts once TOTP was verified)
  if (req.cookies?.[ADMIN.cookie]) {
    const s = await readAdminSession(req);
    if (s?.mfaVerified) {
      req.adminUser = s.user;
      req.adminSession = s;
      if (Date.now() - s.lastSeenAt.getTime() > MIN) {
        await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
      }
      if (!req.user) req.user = s.user; // lets admins preview pending ads/photos
    } else if (!s && mayClear) {
      res.clearCookie(ADMIN.cookie, clearOpts("ADMIN"));
    }
  }
  next();
}

/** Sliding expiry for public sessions; only called from GET /api/auth/me (never CDN-cached). */
export async function touchSession(req, res) {
  const s = req.session;
  if (!s || Date.now() - s.lastSeenAt.getTime() < 3_600_000) return;
  await prisma.session.update({
    where: { id: s.id },
    data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + config.sessionDays * DAY) },
  });
  res.cookie(config.cookieName, s.token, cookieOpts("USER"));
}

export function requireAuth(req, _res, next) {
  if (!req.user) fail("AUTH_REQUIRED", 401);
  next();
}

export const requireRole = (role) => (req, _res, next) => {
  if (role === "ADMIN") return requireAdmin(req, _res, next);
  if (!req.user) fail("AUTH_REQUIRED", 401);
  if (req.user.role !== role) fail("FORBIDDEN", 403);
  next();
};

/** Verified admin session (password + TOTP) required. */
export function requireAdmin(req, _res, next) {
  if (!req.adminUser) fail("ADMIN_AUTH_REQUIRED", 401);
  next();
}

export function requireEmailVerified(req, _res, next) {
  if (!req.user?.emailVerifiedAt) fail("EMAIL_NOT_VERIFIED", 403);
  next();
}

/**
 * CSRF defence for cookie auth: state-changing requests must come from our
 * own origin. SameSite already blocks most cross-site posts; this closes the rest.
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
