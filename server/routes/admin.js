import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { fail } from "../lib/errors.js";
import { decryptNic, encryptNic, nicHash, hashPassword, randomToken } from "../lib/security.js";
import { deleteImage, sendImage, upload, savePrivateImage, saveMediaImage } from "../lib/storage.js";
import { sendInvite } from "../lib/invite.js";
import { checkNicEligibility, maskNic, calcAge } from "../../shared/nic.js";
import { sendMail } from "../lib/mailer.js";
import { requireAdmin } from "../middleware/auth.js";
import { formatLkPhone, normalizeLkPhone, LIMITS } from "../../shared/constants.js";
import { adView, displayStatus, parseAd } from "./ads.js";

const r = Router();
r.use(requireAdmin);

const DAY = 86_400_000;
const PAGE = 30;
const reason = z.string().trim().max(500).optional().default("");
const page = (q) => Math.max(1, Math.min(1000, Number(q.page) || 1));

async function audit(req, action, targetType, targetId, details) {
  await prisma.auditLog.create({ data: { adminId: req.adminUser.id, action, targetType, targetId, details: details ?? undefined } });
}

// ---- stats ---------------------------------------------------------------------
r.get("/stats", async (_req, res) => {
  const now = new Date();
  const [pendingVerifications, pendingAds, openReports, liveAds, publishers, verifiedPublishers, bannedUsers, newUsers7d] = await Promise.all([
    prisma.verification.count({ where: { status: "PENDING" } }),
    prisma.ad.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.adReport.count({ where: { status: "OPEN" } }),
    prisma.ad.count({ where: { status: "APPROVED", expiresAt: { gt: now } } }),
    prisma.user.count({ where: { role: "PUBLISHER" } }),
    prisma.verification.count({ where: { status: "APPROVED" } }),
    prisma.user.count({ where: { isBanned: true } }),
    prisma.user.count({ where: { createdAt: { gt: new Date(Date.now() - 7 * DAY) } } }),
  ]);
  res.json({ pendingVerifications, pendingAds, openReports, liveAds, publishers, verifiedPublishers, bannedUsers, newUsers7d });
});

// ---- verifications ---------------------------------------------------------------
r.get("/verifications", async (req, res) => {
  const status = z.enum(["PENDING", "APPROVED", "REJECTED"]).catch("PENDING").parse(req.query.status);
  const rows = await prisma.verification.findMany({
    where: { status },
    orderBy: { submittedAt: status === "PENDING" ? "asc" : "desc" },
    take: 50,
    include: { user: { select: { email: true, phone: true, isBanned: true, createdAt: true } } },
  });
  res.json({
    items: rows.map((v) => ({
      id: v.id,
      status: v.status,
      email: v.user.email,
      phone: formatLkPhone(v.user.phone),
      accountCreated: v.user.createdAt,
      nicMasked: v.nicMasked,
      nicFormat: v.nicFormat,
      birthDate: v.birthDate.toISOString().slice(0, 10),
      age: calcAge(v.birthDate),
      gender: v.nicGender.toLowerCase(),
      submittedAt: v.submittedAt,
      reviewedAt: v.reviewedAt,
      rejectionReason: v.rejectionReason,
      images: v.nicFrontKey
        ? { front: `/api/admin/verifications/${v.id}/image/front`, back: `/api/admin/verifications/${v.id}/image/back`, selfie: `/api/admin/verifications/${v.id}/image/selfie` }
        : null,
    })),
  });
});

const IMAGE_FIELD = { front: "nicFrontKey", back: "nicBackKey", selfie: "selfieKey" };
r.get("/verifications/:id/image/:kind", async (req, res) => {
  const field = IMAGE_FIELD[req.params.kind];
  if (!field) return res.status(404).end();
  const v = await prisma.verification.findUnique({ where: { id: String(req.params.id) } });
  if (!v?.[field]) return res.status(404).end();
  sendImage(res, "private", v[field]);
});

// The reviewer needs the full number to compare with the card photo. Every reveal is audited.
r.post("/verifications/:id/reveal-nic", async (req, res) => {
  const v = await prisma.verification.findUnique({ where: { id: String(req.params.id) } });
  if (!v) fail("NOT_FOUND", 404);
  await audit(req, "REVEAL_NIC", "verification", v.id);
  res.json({ nic: decryptNic(v.nicEncrypted) });
});

r.post("/verifications/:id/review", async (req, res) => {
  const body = z.object({ approve: z.boolean(), reason }).parse(req.body);
  if (!body.approve && !body.reason) fail("REASON_REQUIRED");
  const v = await prisma.verification.findUnique({ where: { id: String(req.params.id) }, include: { user: true } });
  if (!v) fail("NOT_FOUND", 404);
  if (v.status !== "PENDING") fail("ALREADY_REVIEWED", 409);

  await prisma.verification.update({
    where: { id: v.id },
    data: {
      status: body.approve ? "APPROVED" : "REJECTED",
      rejectionReason: body.approve ? null : body.reason,
      reviewedById: req.adminUser.id,
      reviewedAt: new Date(),
      // Retention: ID images are destroyed as soon as a decision is made.
      nicFrontKey: null,
      nicBackKey: null,
      selfieKey: null,
    },
  });
  await Promise.all([deleteImage("private", v.nicFrontKey), deleteImage("private", v.nicBackKey), deleteImage("private", v.selfieKey)]);
  await audit(req, body.approve ? "APPROVE_VERIFICATION" : "REJECT_VERIFICATION", "verification", v.id, body.approve ? null : { reason: body.reason });
  await sendMail(v.user.email, v.user.locale, body.approve ? "verificationApproved" : "verificationRejected", {
    reason: body.reason,
    path: body.approve ? "/post" : "/verify",
  });
  res.json({ ok: true });
});

// ---- ads -----------------------------------------------------------------------------
r.get(["/listings", "/ads"], async (req, res) => {
  const status = z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "REMOVED"]).catch("PENDING_REVIEW").parse(req.query.status);
  const p = page(req.query);
  const where = { status };
  const [total, rows] = await Promise.all([
    prisma.ad.count({ where }),
    prisma.ad.findMany({
      where,
      orderBy: { updatedAt: status === "PENDING_REVIEW" ? "asc" : "desc" },
      skip: (p - 1) * PAGE,
      take: PAGE,
      include: {
        photos: true,
        publisher: { select: { email: true, isBanned: true, termsAcceptedAt: true, verification: { select: { nicGender: true, status: true } } } },
        _count: { select: { reports: { where: { status: "OPEN" } } } },
      },
    }),
  ]);
  res.json({
    total,
    page: p,
    pageSize: PAGE,
    items: rows.map((a) => ({
      ...adView(a, { full: true, owner: true }),
      publisherEmail: a.publisher.email,
      publisherBanned: a.publisher.isBanned,
      publisherActivated: Boolean(a.publisher.termsAcceptedAt),
      publisherVerification: a.publisher.verification?.status || "NOT_SUBMITTED",
      nicGender: a.publisher.verification?.nicGender?.toLowerCase(),
      openReports: a._count.reports,
    })),
  });
});

r.post(["/listings/:id/review", "/ads/:id/review"], async (req, res) => {
  const body = z.object({ action: z.enum(["approve", "reject", "remove"]), reason }).parse(req.body);
  if (body.action !== "approve" && !body.reason) fail("REASON_REQUIRED");
  const ad = await prisma.ad.findUnique({ where: { id: String(req.params.id) }, include: { publisher: true } });
  if (!ad) fail("NOT_FOUND", 404);
  if (body.action === "approve" && ad.status !== "PENDING_REVIEW") fail("ALREADY_REVIEWED", 409);
  if (body.action === "reject" && ad.status !== "PENDING_REVIEW") fail("ALREADY_REVIEWED", 409);

  const now = new Date();
  const data = { reviewedById: req.adminUser.id, reviewedAt: now };
  if (body.action === "approve") Object.assign(data, { status: "APPROVED", rejectReason: null, approvedAt: now, expiresAt: new Date(now.getTime() + LIMITS.adLifetimeDays * DAY) });
  if (body.action === "reject") Object.assign(data, { status: "REJECTED", rejectReason: body.reason });
  if (body.action === "remove") Object.assign(data, { status: "REMOVED", rejectReason: body.reason });
  await prisma.ad.update({ where: { id: ad.id }, data });
  if (body.action === "remove") {
    await prisma.adReport.updateMany({ where: { adId: ad.id, status: "OPEN" }, data: { status: "RESOLVED", resolvedById: req.adminUser.id, resolvedAt: now } });
  }
  await audit(req, `${body.action.toUpperCase()}_AD`, "ad", ad.id, body.reason ? { reason: body.reason } : null);
  const kind = { approve: "adApproved", reject: "adRejected", remove: "adRemoved" }[body.action];
  await sendMail(ad.publisher.email, ad.publisher.locale, kind, { title: ad.title, reason: body.reason, path: "/my-listings" });
  res.json({ ok: true });
});

// ---- reports ------------------------------------------------------------------------
r.get("/reports", async (req, res) => {
  const status = z.enum(["OPEN", "RESOLVED", "DISMISSED"]).catch("OPEN").parse(req.query.status);
  const rows = await prisma.adReport.findMany({
    where: { status },
    orderBy: { createdAt: status === "OPEN" ? "asc" : "desc" },
    take: 100,
    include: { ad: { select: { id: true, title: true, status: true, expiresAt: true } } },
  });
  res.json({
    items: rows.map((x) => ({
      id: x.id,
      reason: x.reason,
      details: x.details,
      status: x.status,
      createdAt: x.createdAt,
      ad: { id: x.ad.id, title: x.ad.title, status: displayStatus(x.ad) },
    })),
  });
});

r.post("/reports/:id", async (req, res) => {
  const body = z.object({ action: z.enum(["dismiss", "resolve"]) }).parse(req.body);
  const rep = await prisma.adReport.findUnique({ where: { id: String(req.params.id) } });
  if (!rep) fail("NOT_FOUND", 404);
  await prisma.adReport.update({
    where: { id: rep.id },
    data: { status: body.action === "dismiss" ? "DISMISSED" : "RESOLVED", resolvedById: req.adminUser.id, resolvedAt: new Date() },
  });
  await audit(req, body.action === "dismiss" ? "DISMISS_REPORT" : "RESOLVE_REPORT", "report", rep.id, { adId: rep.adId });
  res.json({ ok: true });
});

// ---- users ----------------------------------------------------------------------------
r.get("/users", async (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 100);
  const p = page(req.query);
  const where = {
    role: "PUBLISHER",
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/^0/, "") } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (p - 1) * PAGE,
      take: PAGE,
      include: { verification: { select: { status: true } }, _count: { select: { ads: true } } },
    }),
  ]);
  res.json({
    total,
    page: p,
    pageSize: PAGE,
    items: rows.map((u) => ({
      id: u.id,
      email: u.email,
      phone: formatLkPhone(u.phone),
      emailVerified: Boolean(u.emailVerifiedAt),
      banned: u.isBanned,
      bannedReason: u.bannedReason,
      status: u.verification?.status || "NOT_SUBMITTED",
      invited: !u.claimedAt,
      ads: u._count.ads,
      createdAt: u.createdAt,
    })),
  });
});

r.post("/users/:id/ban", async (req, res) => {
  const body = z.object({ banned: z.boolean(), reason }).parse(req.body);
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!u || u.role === "ADMIN") fail("NOT_FOUND", 404);
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { isBanned: body.banned, bannedReason: body.banned ? body.reason || null : null } }),
    ...(body.banned ? [prisma.session.deleteMany({ where: { userId: u.id } })] : []),
  ]);
  await audit(req, body.banned ? "BAN_USER" : "UNBAN_USER", "user", u.id, body.reason ? { reason: body.reason, email: u.email } : { email: u.email });
  res.json({ ok: true });
});

// ---- add a publisher on someone's behalf ------------------------------------------------
// The account is INACTIVE until the person opens the emailed link, sets their own
// password and accepts the terms. Optional NIC + photos go to the normal
// Verifications queue with exactly the same checks as self-verification.
const idFiles = upload.fields([
  { name: "front", maxCount: 1 },
  { name: "back", maxCount: 1 },
  { name: "selfie", maxCount: 1 },
  { name: "photos", maxCount: LIMITS.photosPerAd },
]);

r.post(["/users", "/publishers"], idFiles, async (req, res) => {
  const body = z
    .object({
      email: z.string().trim().toLowerCase().email().max(254),
      phone: z.string().max(20),
      locale: z.enum(["en", "si", "ta"]).default("en"),
      nic: z.string().max(20).optional().default(""),
      consent: z.literal("true"),
    })
    .safeParse(req.body);
  if (!body.success) {
    const f = body.error.issues.map((i) => i.path[0]);
    if (f.includes("consent")) fail("CONSENT_REQUIRED");
    if (f.includes("email")) fail("INVALID_EMAIL");
    fail("FIELDS_REQUIRED");
  }
  const { email, locale } = body.data;
  const phone = normalizeLkPhone(body.data.phone);
  if (!phone) fail("INVALID_PHONE");

  const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { phone }] } });
  if (existing?.isBanned) fail("BANNED", 403);
  if (existing?.email === email) fail("EMAIL_TAKEN", 409);
  if (existing) fail("PHONE_TAKEN", 409);

  // Optional identity documents: same rules as self-verification.
  let check = null;
  const files = req.files || {};
  if (body.data.nic.trim()) {
    check = checkNicEligibility(body.data.nic);
    if (!check.valid) fail(check.error);
    if (!files.front?.[0] || !files.back?.[0] || !files.selfie?.[0]) fail("FILES_REQUIRED");
  }

  // Optional first ad prepared with the person. Age comes from the NIC, so a NIC is
  // required; the same validation as a publisher's own ad applies. It stays hidden
  // until they activate, their ID is approved and the ad itself is approved.
  let adData = null;
  if (req.body.withAd === "true") {
    if (!check) fail("NIC_REQUIRED_FOR_AD");
    adData = parseAd(
      {
        gender: req.body.adGender,
        title: req.body.adTitle,
        description: req.body.adDescription,
        districtId: req.body.adDistrictId,
        tags: req.body.adTags || "",
        contactPhone: "",
      },
      { phone },
      { nicGender: check.gender === "female" ? "FEMALE" : "MALE" }
    );
  }

  const saved = [];
  const savedMedia = [];
  try {
    if (check) for (const k of ["front", "back", "selfie"]) saved.push(await savePrivateImage(files[k][0].buffer));
    if (adData) for (const f of files.photos || []) savedMedia.push(await saveMediaImage(f.buffer));
    const user = await prisma.$transaction(async (tx) => {
      const hash = check ? nicHash(check.nic) : null;
      if (hash) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hash}))`;
        const taken = await tx.verification.findFirst({ where: { nicHash: hash, status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } });
        if (taken) fail("NIC_TAKEN", 409);
      }
      const created = await tx.user.create({
        data: {
          email,
          phone,
          locale,
          role: "PUBLISHER",
          // Unusable until the person sets their own password via the invitation.
          passwordHash: await hashPassword(randomToken(32)),
          invitedById: req.adminUser.id,
          ...(check && {
            verification: {
              create: {
                status: "PENDING",
                nicEncrypted: encryptNic(check.nic),
                nicHash: hash,
                nicMasked: maskNic(check.nic),
                nicFormat: check.format,
                birthDate: new Date(check.birthDate + "T00:00:00Z"),
                nicGender: check.gender === "female" ? "FEMALE" : "MALE",
                nicFrontKey: saved[0].key,
                nicBackKey: saved[1].key,
                selfieKey: saved[2].key,
              },
            },
          }),
        },
      });
      if (adData) {
        await tx.ad.create({
          data: {
            ...adData,
            publisherId: created.id,
            birthDate: new Date(check.birthDate + "T00:00:00Z"),
            status: "PENDING_REVIEW",
            photos: { create: savedMedia.map((m, i) => ({ key: m.key, width: m.width, height: m.height, sort: i })) },
          },
        });
      }
      return created;
    });
    await audit(req, "CREATE_PUBLISHER", "user", user.id, { email, withIdDocuments: Boolean(check), withAd: Boolean(adData), photos: savedMedia.length });
    await sendInvite(user, { withAd: Boolean(adData) });
    res.status(201).json({
      id: user.id,
      email: user.email,
      verification: check ? "PENDING" : "NOT_SUBMITTED",
      ad: adData ? "PENDING_REVIEW" : null,
      photos: savedMedia.length,
    });
  } catch (e) {
    await Promise.all([...saved.map((x) => deleteImage("private", x.key)), ...savedMedia.map((x) => deleteImage("media", x.key))]);
    throw e;
  }
});

r.post("/users/:id/invite", async (req, res) => {
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) } });
  if (!u || u.role !== "PUBLISHER") fail("NOT_FOUND", 404);
  if (u.claimedAt) fail("ALREADY_ACTIVATED", 409);
  if (u.isBanned) fail("BANNED", 403);
  await sendInvite(u);
  await audit(req, "RESEND_INVITE", "user", u.id, { email: u.email });
  res.json({ ok: true });
});

// ---- audit log ----------------------------------------------------------------------------
r.get("/audit", async (req, res) => {
  const p = page(req.query);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count(),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, skip: (p - 1) * 50, take: 50, include: { admin: { select: { email: true } } } }),
  ]);
  res.json({ total, page: p, pageSize: 50, items: rows.map((a) => ({ ...a, admin: a.admin.email })) });
});

export default r;
