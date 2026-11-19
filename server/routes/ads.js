import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { fail } from "../lib/errors.js";
import { hmac } from "../lib/security.js";
import { upload, saveMediaImage, deleteImage, sendImage } from "../lib/storage.js";
import { requireRole, requireTerms } from "../middleware/auth.js";
import { calcAge } from "../../shared/nic.js";
import { AD_TAGS, GENDERS, LIMITS, REPORT_REASONS, normalizeLkPhone, formatLkPhone } from "../../shared/constants.js";
import { DISTRICTS } from "../../shared/locations.js";

const r = Router();
const DAY = 86_400_000;
const limiter = (windowMin, max) => rateLimit({ windowMs: windowMin * 60_000, limit: max, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "RATE_LIMITED" } });

// ---- helpers ----------------------------------------------------------------
const G = { male: "MALE", female: "FEMALE", transgender: "TRANSGENDER" };
const photoUrl = (p) => `/media/${p.key}.webp`;

/** Where-clause for ads any visitor may see. */
export const publicWhere = () => ({
  status: "APPROVED",
  expiresAt: { gt: new Date() },
  // Publisher must be unbanned, ID-approved, and have activated their account themselves.
  publisher: { isBanned: false, termsAcceptedAt: { not: null }, verification: { is: { status: "APPROVED" } } },
});

export function displayStatus(ad) {
  if (ad.status === "APPROVED" && ad.expiresAt && ad.expiresAt < new Date()) return "EXPIRED";
  return ad.status;
}

export function adView(ad, { full = false, owner = false } = {}) {
  const photos = (ad.photos || []).sort((a, b) => a.sort - b.sort);
  const v = {
    id: ad.id,
    title: ad.title,
    gender: ad.gender.toLowerCase(),
    age: calcAge(ad.birthDate),
    districtId: ad.districtId,
    tags: ad.tags,
    verified: true,
    photo: photos[0] ? photoUrl(photos[0]) : null,
    photoCount: photos.length,
    createdAt: ad.approvedAt || ad.createdAt,
  };
  if (full) {
    v.description = ad.description;
    v.photos = photos.map((p) => ({ id: p.id, url: photoUrl(p), width: p.width, height: p.height }));
    v.hasPhone = Boolean(ad.contactPhone);
  }
  if (owner) {
    v.status = displayStatus(ad);
    v.rejectReason = ad.rejectReason;
    v.expiresAt = ad.expiresAt;
    v.views = ad.views;
    v.contactPhone = ad.contactPhone ? formatLkPhone(ad.contactPhone) : "";
    v.canRenew = ad.status === "APPROVED" && ad.expiresAt && ad.expiresAt.getTime() - Date.now() < LIMITS.renewWindowDays * DAY;
  }
  return v;
}

function yearsAgo(n) {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - n, d.getUTCMonth(), d.getUTCDate()));
}

const canManage = (req, ad) => Boolean(req.adminUser) || (req.user?.role === "PUBLISHER" && req.user.id === ad.publisherId);

// ---- public listing -------------------------------------------------------------
const listQuery = z.object({
  gender: z.enum(GENDERS).optional().catch(undefined),
  ageMin: z.coerce.number().int().min(18).max(99).optional().catch(undefined),
  ageMax: z.coerce.number().int().min(18).max(99).optional().catch(undefined),
  districtId: z.coerce.number().int().min(1).max(25).optional().catch(undefined),
  tags: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter((t) => AD_TAGS.includes(t)) : []))
    .catch([]),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});

r.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = publicWhere();
  if (q.gender) where.gender = G[q.gender];
  if (q.districtId) where.districtId = q.districtId;
  if (q.tags.length) where.tags = { hasEvery: q.tags };
  const birth = {};
  if (q.ageMin) birth.lte = yearsAgo(q.ageMin); // age >= min
  if (q.ageMax) birth.gt = yearsAgo(q.ageMax + 1); // age <= max
  if (birth.lte || birth.gt) where.birthDate = birth;

  const [total, rows] = await Promise.all([
    prisma.ad.count({ where }),
    prisma.ad.findMany({
      where,
      orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * LIMITS.pageSize,
      take: LIMITS.pageSize,
      include: { photos: { orderBy: { sort: "asc" }, take: 1 } },
    }),
  ]);
  res.set("Cache-Control", "public, max-age=15");
  res.json({ items: rows.map((a) => adView(a)), total, page: q.page, pageSize: LIMITS.pageSize });
});

// ---- publisher: my ads -------------------------------------------------------------
r.get("/mine", requireRole("PUBLISHER"), async (req, res) => {
  const rows = await prisma.ad.findMany({
    where: { publisherId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: { photos: true },
  });
  res.json({ items: rows.map((a) => adView(a, { full: true, owner: true })) });
});

// ---- single ad -------------------------------------------------------------------------
r.get("/:id", async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: String(req.params.id) }, include: { photos: true } });
  if (!ad) fail("NOT_FOUND", 404);
  const isPublic = await prisma.ad.count({ where: { id: ad.id, ...publicWhere() } });
  const manage = canManage(req, ad);
  if (!isPublic && !manage) fail("NOT_FOUND", 404);
  if (isPublic && !manage) await prisma.ad.update({ where: { id: ad.id }, data: { views: { increment: 1 } } });
  res.json(adView(ad, { full: true, owner: manage }));
});

// Phone numbers are never in list/detail payloads; revealing one is an explicit, rate-limited action.
r.post("/:id/contact", limiter(60, 30), async (req, res) => {
  const ad = await prisma.ad.findFirst({ where: { id: String(req.params.id), ...publicWhere() }, select: { contactPhone: true } });
  if (!ad?.contactPhone) fail("NOT_FOUND", 404);
  res.json({ phone: formatLkPhone(ad.contactPhone), tel: ad.contactPhone });
});

r.post("/:id/report", limiter(60, 10), async (req, res) => {
  const body = z.object({ reason: z.enum(REPORT_REASONS), details: z.string().trim().max(500).optional() }).safeParse(req.body);
  if (!body.success) fail("FIELDS_REQUIRED");
  const ad = await prisma.ad.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
  if (!ad) fail("NOT_FOUND", 404);
  const reporterHash = hmac("report:" + req.ip);
  const dupe = await prisma.adReport.findFirst({ where: { adId: ad.id, reporterHash, status: "OPEN" } });
  if (!dupe) {
    await prisma.adReport.create({ data: { adId: ad.id, reason: body.data.reason, details: body.data.details || null, reporterHash } });
  }
  res.status(201).json({ ok: true });
});

// ---- publisher: create / edit / delete / renew -------------------------------------------
// Cheap first line of defence against ads implying minors. Manual review is the real gate.
const BLOCKED_TERMS = /\b(teen|teens|teenage|teenager|schoolgirl|schoolboy|school\s*girl|school\s*boy|underage|under\s*18|loli|lolita|jailbait|1[0-7]\s*(yo|y\/o|yrs?|years?(\s*old)?))\b/i;

const adBody = z.object({
  gender: z.enum(GENDERS),
  title: z.string().trim().min(3).max(LIMITS.titleMax),
  description: z.string().trim().min(LIMITS.descriptionMin).max(LIMITS.descriptionMax),
  districtId: z.coerce.number().int().min(1).max(DISTRICTS.length),
  tags: z
    .preprocess((v) => (typeof v === "string" ? (v ? v.split(",") : []) : v), z.array(z.enum(AD_TAGS)).max(AD_TAGS.length))
    .default([]),
  contactPhone: z.string().max(20).optional().default(""),
});

export function parseAd(body, user, verification) {
  const p = adBody.safeParse(body);
  if (!p.success) {
    const f = p.error.issues.map((i) => i.path[0]);
    if (f.includes("description")) fail("DESCRIPTION_LENGTH");
    if (f.includes("title")) fail("TITLE_LENGTH");
    fail("FIELDS_REQUIRED");
  }
  const d = p.data;
  if (BLOCKED_TERMS.test(`${d.title} ${d.description}`)) fail("CONTENT_NOT_ALLOWED");
  if (d.gender !== "transgender" && G[d.gender] !== verification.nicGender) fail("GENDER_MISMATCH");
  let phone = null;
  if (d.contactPhone.trim()) {
    phone = normalizeLkPhone(d.contactPhone);
    if (!phone) fail("INVALID_PHONE");
  } else phone = user.phone;
  return { gender: G[d.gender], title: d.title, description: d.description, districtId: d.districtId, tags: [...new Set(d.tags)], contactPhone: phone };
}

async function approvedVerification(user) {
  const v = await prisma.verification.findUnique({ where: { userId: user.id } });
  if (v?.status !== "APPROVED") fail("NOT_VERIFIED", 403);
  return v;
}

const photoUpload = upload.array("photos", LIMITS.photosPerAd);

r.post("/", requireRole("PUBLISHER"), requireTerms, limiter(60, 20), photoUpload, async (req, res) => {
  const v = await approvedVerification(req.user);
  const data = parseAd(req.body, req.user, v);
  const active = await prisma.ad.count({
    where: { publisherId: req.user.id, OR: [{ status: "PENDING_REVIEW" }, { status: "APPROVED", expiresAt: { gt: new Date() } }] },
  });
  if (active >= LIMITS.activeAdsPerUser) fail("TOO_MANY_ADS", 409);

  const saved = [];
  try {
    for (const f of req.files || []) saved.push(await saveMediaImage(f.buffer));
    const ad = await prisma.ad.create({
      data: {
        ...data,
        publisherId: req.user.id,
        birthDate: v.birthDate,
        photos: { create: saved.map((s, i) => ({ key: s.key, width: s.width, height: s.height, sort: i })) },
      },
      include: { photos: true },
    });
    res.status(201).json(adView(ad, { full: true, owner: true }));
  } catch (e) {
    await Promise.all(saved.map((s) => deleteImage("media", s.key)));
    throw e;
  }
});

async function ownAd(req) {
  const ad = await prisma.ad.findUnique({ where: { id: String(req.params.id) }, include: { photos: true } });
  if (!ad || ad.publisherId !== req.user.id) fail("NOT_FOUND", 404);
  if (ad.status === "REMOVED") fail("AD_REMOVED", 403);
  return ad;
}

r.put("/:id", requireRole("PUBLISHER"), requireTerms, limiter(60, 30), photoUpload, async (req, res) => {
  const v = await approvedVerification(req.user);
  const ad = await ownAd(req);
  const data = parseAd(req.body, req.user, v);

  let keep = [];
  try {
    keep = JSON.parse(req.body.keepPhotos || "[]");
  } catch {
    fail("VALIDATION");
  }
  const kept = ad.photos.filter((p) => Array.isArray(keep) && keep.includes(p.id));
  const dropped = ad.photos.filter((p) => !kept.includes(p));
  const incoming = req.files || [];
  if (kept.length + incoming.length > LIMITS.photosPerAd) fail("TOO_MANY_FILES");

  const saved = [];
  try {
    for (const f of incoming) saved.push(await saveMediaImage(f.buffer));
    const updated = await prisma.$transaction(async (tx) => {
      await tx.adPhoto.deleteMany({ where: { id: { in: dropped.map((p) => p.id) } } });
      await Promise.all(kept.map((p, i) => tx.adPhoto.update({ where: { id: p.id }, data: { sort: i } })));
      return tx.ad.update({
        where: { id: ad.id },
        // Any edit goes back to moderation and is hidden until re-approved.
        data: {
          ...data,
          status: "PENDING_REVIEW",
          rejectReason: null,
          photos: { create: saved.map((s, i) => ({ key: s.key, width: s.width, height: s.height, sort: kept.length + i })) },
        },
        include: { photos: true },
      });
    });
    await Promise.all(dropped.map((p) => deleteImage("media", p.key)));
    res.json(adView(updated, { full: true, owner: true }));
  } catch (e) {
    await Promise.all(saved.map((s) => deleteImage("media", s.key)));
    throw e;
  }
});

r.delete("/:id", requireRole("PUBLISHER"), async (req, res) => {
  const ad = await prisma.ad.findUnique({ where: { id: String(req.params.id) }, include: { photos: true } });
  if (!ad || ad.publisherId !== req.user.id) fail("NOT_FOUND", 404);
  await prisma.ad.delete({ where: { id: ad.id } });
  await Promise.all(ad.photos.map((p) => deleteImage("media", p.key)));
  res.json({ ok: true });
});

r.post("/:id/renew", requireRole("PUBLISHER"), async (req, res) => {
  await approvedVerification(req.user);
  const ad = await ownAd(req);
  const ok = ad.status === "APPROVED" && ad.expiresAt && ad.expiresAt.getTime() - Date.now() < LIMITS.renewWindowDays * DAY;
  if (!ok) fail("CANNOT_RENEW", 409);
  const updated = await prisma.ad.update({
    where: { id: ad.id },
    data: { expiresAt: new Date(Date.now() + LIMITS.adLifetimeDays * DAY) },
    include: { photos: true },
  });
  res.json(adView(updated, { full: true, owner: true }));
});

export default r;

// ---- media: ad photos ------------------------------------------------------------------
export const media = Router();
media.get("/:file", async (req, res) => {
  const key = String(req.params.file).replace(/\.webp$/, "");
  const photo = await prisma.adPhoto.findUnique({ where: { key }, select: { ad: { select: { id: true, publisherId: true } } } });
  if (!photo) return res.status(404).end();
  const isPublic = await prisma.ad.count({ where: { id: photo.ad.id, ...publicWhere() } });
  if (!isPublic && !canManage(req, photo.ad)) return res.status(404).end();
  sendImage(res, "media", key, { publicCache: Boolean(isPublic) });
});
