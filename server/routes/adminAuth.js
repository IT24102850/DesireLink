// Admin portal authentication: password -> TOTP (enrol on first login) -> verified session.
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { fail } from "../lib/errors.js";
import {
  verifyPassword,
  dummyVerify,
  newTotpSecret,
  verifyTotp,
  totpUri,
  newRecoveryCodes,
  recoveryHash,
  encryptSecret,
  decryptSecret,
} from "../lib/security.js";
import { assertNotLocked, recordFailure, recordSuccess, MAX_FAILS } from "../lib/lockout.js";
import { ADMIN, createSession, destroyAdminSession, readAdminSession, requireAdmin } from "../middleware/auth.js";

const r = Router();
const limiter = (windowMin, max) =>
  rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "RATE_LIMITED" } });

async function audit(adminId, action, details) {
  await prisma.auditLog.create({ data: { adminId, action, targetType: "admin", targetId: adminId, details: details ?? undefined } }).catch(() => {});
}

const adminView = (u) => ({ id: u.id, email: u.email, role: u.role, locale: u.locale, mfaEnabled: Boolean(u.totpSecret) });

/** Pending (password OK, TOTP not yet done) or verified admin session from the admin cookie. */
async function pending(req) {
  const s = await readAdminSession(req);
  if (!s) fail("ADMIN_AUTH_REQUIRED", 401);
  return s;
}

async function markVerified(s, req) {
  await prisma.session.update({
    where: { id: s.id },
    data: { mfaVerified: true, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + ADMIN.absoluteTtl) },
  });
  // One active admin session per account: sign out any other admin sessions.
  await prisma.session.deleteMany({ where: { userId: s.userId, kind: "ADMIN", id: { not: s.id } } });
  await recordSuccess(s.user);
  await audit(s.userId, "ADMIN_LOGIN", { ip: req.ip, ua: String(req.get("user-agent") || "").slice(0, 120) });
}

// ---- state -------------------------------------------------------------------------
r.get("/me", async (req, res) => {
  const s = await readAdminSession(req);
  if (!s) return res.json({ admin: null, stage: "PASSWORD" });
  if (s.mfaVerified) return res.json({ admin: adminView(s.user), stage: "DONE", expiresAt: s.expiresAt, idleTimeoutMs: ADMIN.idleTimeout });
  res.json({ admin: null, stage: s.user.totpSecret ? "MFA" : "ENROLL", email: s.user.email });
});

// ---- step 1: password ------------------------------------------------------------------
r.post("/login", limiter(15, 10), async (req, res) => {
  const body = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().max(128) }).safeParse(req.body);
  if (!body.success) fail("BAD_LOGIN", 401);
  const user = await prisma.user.findUnique({ where: { email: body.data.email } });
  if (!user || user.role !== "ADMIN") {
    await dummyVerify(body.data.password);
    fail("BAD_LOGIN", 401);
  }
  assertNotLocked(user);
  if (!(await verifyPassword(user.passwordHash, body.data.password))) {
    const locked = await recordFailure(user, MAX_FAILS.ADMIN);
    await audit(user.id, locked ? "ADMIN_LOCKED" : "ADMIN_LOGIN_FAILED", { step: "password", ip: req.ip });
    fail("BAD_LOGIN", 401);
  }
  if (user.isBanned) fail("BANNED", 403);
  await destroyAdminSession(req, res);
  await createSession(res, user, req, { kind: "ADMIN", mfaVerified: false });
  res.json({ stage: user.totpSecret ? "MFA" : "ENROLL" });
});

// ---- step 2a: first login, enrol an authenticator app ----------------------------------------
r.post("/mfa/setup", limiter(15, 20), async (req, res) => {
  const s = await pending(req);
  if (s.user.totpSecret) fail("MFA_ALREADY_ENABLED", 409);
  const secret = newTotpSecret();
  await prisma.user.update({ where: { id: s.userId }, data: { totpPendingSecret: encryptSecret(secret) } });
  res.json({ secret, uri: totpUri(secret, s.user.email) });
});

r.post("/mfa/enable", limiter(15, 20), async (req, res) => {
  const { code } = z.object({ code: z.string().max(10) }).parse(req.body);
  const s = await pending(req);
  if (s.user.totpSecret) fail("MFA_ALREADY_ENABLED", 409);
  if (!s.user.totpPendingSecret) fail("MFA_SETUP_REQUIRED", 409);
  assertNotLocked(s.user);
  const secret = decryptSecret(s.user.totpPendingSecret);
  const step = verifyTotp(secret, code);
  if (step === null) {
    await recordFailure(s.user, MAX_FAILS.ADMIN);
    fail("CODE_INVALID");
  }
  const { plain, hashes } = newRecoveryCodes();
  await prisma.$transaction([
    prisma.user.update({ where: { id: s.userId }, data: { totpSecret: s.user.totpPendingSecret, totpPendingSecret: null, totpLastStep: step } }),
    prisma.recoveryCode.deleteMany({ where: { userId: s.userId } }),
    prisma.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: s.userId, codeHash })) }),
  ]);
  await audit(s.userId, "MFA_ENABLED", { ip: req.ip });
  await markVerified(s, req);
  res.json({ recoveryCodes: plain });
});

// ---- step 2b: normal login, verify TOTP or a recovery code ----------------------------------
r.post("/mfa/verify", limiter(15, 20), async (req, res) => {
  const body = z.object({ code: z.string().max(10).optional(), recoveryCode: z.string().max(20).optional() }).parse(req.body);
  const s = await pending(req);
  if (s.mfaVerified) return res.json({ ok: true });
  if (!s.user.totpSecret) fail("MFA_SETUP_REQUIRED", 409);
  assertNotLocked(s.user);

  if (body.recoveryCode) {
    const used = await prisma.recoveryCode.updateMany({
      where: { userId: s.userId, codeHash: recoveryHash(body.recoveryCode), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) {
      await recordFailure(s.user, MAX_FAILS.ADMIN);
      await audit(s.userId, "ADMIN_LOGIN_FAILED", { step: "recovery", ip: req.ip });
      fail("CODE_INVALID");
    }
    const left = await prisma.recoveryCode.count({ where: { userId: s.userId, usedAt: null } });
    await audit(s.userId, "RECOVERY_CODE_USED", { remaining: left, ip: req.ip });
    await markVerified(s, req);
    return res.json({ ok: true, recoveryCodesLeft: left });
  }

  const step = verifyTotp(decryptSecret(s.user.totpSecret), body.code, s.user.totpLastStep);
  if (step === null) {
    const locked = await recordFailure(s.user, MAX_FAILS.ADMIN);
    await audit(s.userId, locked ? "ADMIN_LOCKED" : "ADMIN_LOGIN_FAILED", { step: "totp", ip: req.ip });
    fail("CODE_INVALID");
  }
  await prisma.user.update({ where: { id: s.userId }, data: { totpLastStep: step } });
  await markVerified(s, req);
  res.json({ ok: true });
});

// ---- signed-in admin actions -----------------------------------------------------------------
r.post("/logout", async (req, res) => {
  await destroyAdminSession(req, res);
  res.json({ ok: true });
});

/** New recovery codes (old ones are invalidated). Requires a current authenticator code. */
r.post("/recovery-codes", requireAdmin, limiter(15, 5), async (req, res) => {
  const { code } = z.object({ code: z.string().max(10) }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { id: req.adminUser.id } });
  const step = verifyTotp(decryptSecret(u.totpSecret), code, u.totpLastStep);
  if (step === null) fail("CODE_INVALID");
  const { plain, hashes } = newRecoveryCodes();
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { totpLastStep: step } }),
    prisma.recoveryCode.deleteMany({ where: { userId: u.id } }),
    prisma.recoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: u.id, codeHash })) }),
  ]);
  await audit(u.id, "RECOVERY_CODES_REGENERATED", { ip: req.ip });
  res.json({ recoveryCodes: plain });
});

export default r;
