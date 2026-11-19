import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { fail } from "../lib/errors.js";
import { encryptNic, nicHash } from "../lib/security.js";
import { upload, savePrivateImage, deleteImage } from "../lib/storage.js";
import { requireAuth, requireEmailVerified, requireRole, requireTerms } from "../middleware/auth.js";
import { checkNicEligibility, calcAge, maskNic } from "../../shared/nic.js";

const r = Router();
r.use(requireRole("PUBLISHER"));

export const verificationView = (v) =>
  v
    ? {
        status: v.status,
        nicMasked: v.nicMasked,
        birthDate: v.birthDate.toISOString().slice(0, 10),
        age: calcAge(v.birthDate),
        gender: v.nicGender.toLowerCase(),
        rejectionReason: v.rejectionReason,
        submittedAt: v.submittedAt,
        reviewedAt: v.reviewedAt,
      }
    : { status: "NOT_SUBMITTED" };

r.get("/", requireAuth, async (req, res) => {
  const v = await prisma.verification.findUnique({ where: { userId: req.user.id } });
  res.json(verificationView(v));
});

const submitLimiter = rateLimit({ windowMs: 3_600_000, limit: 10, message: { error: "RATE_LIMITED" } });
const fields = upload.fields([
  { name: "front", maxCount: 1 },
  { name: "back", maxCount: 1 },
  { name: "selfie", maxCount: 1 },
]);

r.post("/", requireAuth, requireTerms, requireEmailVerified, submitLimiter, fields, async (req, res) => {
  const existing = await prisma.verification.findUnique({ where: { userId: req.user.id } });
  if (existing && existing.status !== "REJECTED") fail("ALREADY_SUBMITTED", 409);

  // Server is the authority: re-run the full NIC check (format, leap rule, 18+).
  const check = checkNicEligibility(req.body?.nic);
  if (!check.valid) fail(check.error);
  const files = req.files || {};
  if (!files.front?.[0] || !files.back?.[0] || !files.selfie?.[0]) fail("FILES_REQUIRED");

  const hash = nicHash(check.nic);
  const saved = [];
  try {
    for (const k of ["front", "back", "selfie"]) saved.push(await savePrivateImage(files[k][0].buffer));

    const data = {
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
      rejectionReason: null,
      reviewedById: null,
      reviewedAt: null,
      submittedAt: new Date(),
    };

    const v = await prisma.$transaction(async (tx) => {
      // Serialize submissions of the same NIC so two accounts can't race past the duplicate check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${hash}))`;
      const taken = await tx.verification.findFirst({
        where: { nicHash: hash, userId: { not: req.user.id }, status: { in: ["PENDING", "APPROVED"] } },
        select: { id: true },
      });
      if (taken) fail("NIC_TAKEN", 409);
      return tx.verification.upsert({ where: { userId: req.user.id }, create: { userId: req.user.id, ...data }, update: data });
    });
    res.status(201).json(verificationView(v));
  } catch (e) {
    await Promise.all(saved.map((s) => deleteImage("private", s.key)));
    throw e;
  }
});

export default r;
