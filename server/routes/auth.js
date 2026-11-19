import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { fail } from "../lib/errors.js";
import { verifyCaptcha } from "../lib/captcha.js";
import { sendMail } from "../lib/mailer.js";
import { hashPassword, verifyPassword, dummyVerify, randomCode, hmac, safeEqual } from "../lib/security.js";
import { createSession, destroySession, publicUser, requireAuth, touchSession } from "../middleware/auth.js";
import { deleteImage } from "../lib/storage.js";
import { LIMITS, normalizeLkPhone } from "../../shared/constants.js";

const r = Router();

const limiter = (windowMin, max) =>
  rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "RATE_LIMITED" } });

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);
const locale = z.enum(["en", "si", "ta"]);
const CODE_TTL_MS = 15 * 60_000;

// ---- one-time codes ---------------------------------------------------------
async function issueCode(user, purpose) {
  const recent = await prisma.authCode.findMany({
    where: { userId: user.id, purpose, createdAt: { gt: new Date(Date.now() - 3_600_000) } },
    orderBy: { createdAt: "desc" },
  });
  if (recent[0] && Date.now() - recent[0].createdAt.getTime() < 60_000) fail("CODE_TOO_SOON", 429);
  if (recent.length >= 5) fail("RATE_LIMITED", 429);
  const code = randomCode();
  await prisma.authCode.create({
    data: { userId: user.id, purpose, codeHash: hmac(`${purpose}:${user.id}:${code}`), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
  });
  await sendMail(user.email, user.locale, purpose === "EMAIL_VERIFY" ? "code" : "reset", { code });
}

async function consumeCode(user, purpose, code) {
  const row = await prisma.authCode.findFirst({
    where: { userId: user.id, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!row || row.attempts >= 5) fail("CODE_INVALID");
  if (!safeEqual(row.codeHash, hmac(`${purpose}:${user.id}:${String(code).trim()}`))) {
    await prisma.authCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    fail("CODE_INVALID");
  }
  await prisma.authCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
}

// ---- register / login ------------------------------------------------------
r.post("/register", limiter(60, 10), async (req, res) => {
  const body = z
    .object({ email, password, phone: z.string().max(20), locale: locale.default("en"), captcha: z.string().optional(), acceptTerms: z.literal(true) })
    .safeParse(req.body);
  if (!body.success) {
    const f = body.error.issues.map((i) => i.path[0]);
    if (f.includes("password")) fail("WEAK_PASSWORD");
    if (f.includes("acceptTerms")) fail("TERMS_REQUIRED");
    if (f.includes("email")) fail("INVALID_EMAIL");
    fail("FIELDS_REQUIRED");
  }
  const { email: em, password: pw, locale: loc, captcha } = body.data;
  const phone = normalizeLkPhone(body.data.phone);
  if (!phone) fail("INVALID_PHONE");
  await verifyCaptcha(captcha, req.ip);

  const existing = await prisma.user.findFirst({ where: { OR: [{ email: em }, { phone }] } });
  if (existing?.isBanned) fail("BANNED", 403);
  if (existing?.email === em) fail("EMAIL_TAKEN", 409);
  if (existing) fail("PHONE_TAKEN", 409);

  const user = await prisma.user.create({ data: { email: em, phone, passwordHash: await hashPassword(pw), locale: loc } });
  await createSession(res, user, req);
  await issueCode(user, "EMAIL_VERIFY").catch((e) => console.error("[register] code send failed", e.message));
  res.status(201).json({ user: publicUser(user) });
});

r.post("/login", limiter(15, 20), async (req, res) => {
  const body = z.object({ email, password: z.string().max(LIMITS.passwordMax), captcha: z.string().optional() }).safeParse(req.body);
  if (!body.success) fail("BAD_LOGIN", 401);
  const user = await prisma.user.findUnique({ where: { email: body.data.email } });
  const ok = user ? await verifyPassword(user.passwordHash, body.data.password) : await dummyVerify(body.data.password);
  if (!ok) fail("BAD_LOGIN", 401);
  if (user.isBanned) fail("BANNED", 403);
  await createSession(res, user, req);
  res.json({ user: publicUser(user) });
});

r.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

r.get("/me", async (req, res) => {
  await touchSession(req, res);
  res.json({ user: publicUser(req.user) || null });
});

// ---- email confirmation ----------------------------------------------------
r.post("/email/resend", requireAuth, async (req, res) => {
  if (req.user.emailVerifiedAt) return res.json({ ok: true });
  await issueCode(req.user, "EMAIL_VERIFY");
  res.json({ ok: true });
});

r.post("/email/confirm", requireAuth, limiter(15, 20), async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  if (!req.user.emailVerifiedAt) {
    await consumeCode(req.user, "EMAIL_VERIFY", code);
    req.user = await prisma.user.update({ where: { id: req.user.id }, data: { emailVerifiedAt: new Date() } });
  }
  res.json({ user: publicUser(req.user) });
});

// ---- password reset ----------------------------------------------------------
r.post("/password/forgot", limiter(60, 10), async (req, res) => {
  const body = z.object({ email, captcha: z.string().optional() }).safeParse(req.body);
  if (!body.success) fail("INVALID_EMAIL");
  await verifyCaptcha(body.data.captcha, req.ip);
  const user = await prisma.user.findUnique({ where: { email: body.data.email } });
  // Same response whether or not the account exists (no account enumeration).
  if (user && !user.isBanned) await issueCode(user, "PASSWORD_RESET").catch(() => {});
  res.json({ ok: true });
});

r.post("/password/reset", limiter(15, 20), async (req, res) => {
  const body = z.object({ email, code: z.string().regex(/^\d{6}$/), password }).safeParse(req.body);
  if (!body.success) fail(body.error.issues.some((i) => i.path[0] === "password") ? "WEAK_PASSWORD" : "CODE_INVALID");
  const user = await prisma.user.findUnique({ where: { email: body.data.email } });
  if (!user || user.isBanned) fail("CODE_INVALID");
  await consumeCode(user, "PASSWORD_RESET", body.data.code);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.data.password), emailVerifiedAt: user.emailVerifiedAt ?? new Date() } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  res.json({ ok: true });
});

r.post("/password/change", requireAuth, limiter(15, 10), async (req, res) => {
  const body = z.object({ current: z.string().max(LIMITS.passwordMax), password }).safeParse(req.body);
  if (!body.success) fail("WEAK_PASSWORD");
  if (!(await verifyPassword(req.user.passwordHash, body.data.current))) fail("WRONG_PASSWORD", 400);
  await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await hashPassword(body.data.password) } }),
    prisma.session.deleteMany({ where: { userId: req.user.id } }),
  ]);
  await createSession(res, req.user, req);
  res.json({ ok: true });
});

// ---- preferences / account deletion -------------------------------------------
r.post("/locale", requireAuth, async (req, res) => {
  const { locale: loc } = z.object({ locale }).parse(req.body);
  await prisma.user.update({ where: { id: req.user.id }, data: { locale: loc } });
  res.json({ ok: true });
});

r.post("/delete-account", requireAuth, limiter(15, 5), async (req, res) => {
  const { password: pw } = z.object({ password: z.string().max(LIMITS.passwordMax) }).parse(req.body);
  if (req.user.role === "ADMIN") fail("FORBIDDEN", 403);
  if (!(await verifyPassword(req.user.passwordHash, pw))) fail("WRONG_PASSWORD");
  const [verification, photos] = await Promise.all([
    prisma.verification.findUnique({ where: { userId: req.user.id } }),
    prisma.adPhoto.findMany({ where: { ad: { publisherId: req.user.id } }, select: { key: true } }),
  ]);
  await prisma.user.delete({ where: { id: req.user.id } });
  await Promise.all([
    ...photos.map((p) => deleteImage("media", p.key)),
    ...["nicFrontKey", "nicBackKey", "selfieKey"].map((k) => deleteImage("private", verification?.[k])),
  ]);
  await destroySession(req, res);
  res.json({ ok: true });
});

export default r;
